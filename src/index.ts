import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fetchGitHubToken } from './shared/github-token';
import { getGitHubContext } from './shared/github-context';
import { upsertComment } from './shared/github-comments';
import { formatChangelogComment, ReleaseStatus } from './shared/changelog';

const VERSION = '1.0.0';
const ACTION_NAME = 'release-domains';

interface ExecOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface LockResponse {
  ticketId: string;
  status: string;
  environmentId?: string;
  environmentName?: string;
}

interface Inputs {
  sfpServerUrl: string;
  sfpServerToken: string;
  environment: string;
  releaseCandidates: string;  // format: "domain:name" or "domain1:name1,domain2:name2"
  repository: string;
  devhubAlias: string;
  waitTime: string;
  tag: string;
  excludePackages: string;
  overridePackages: string;
  lock: boolean;
  lockTimeout: string;
  lockDuration: string;
  dryRun: boolean;
  generateChangelog: boolean;
  updateIssue: boolean;
  issueNumber: number | null;
}

function printHeader(inputs: Inputs): void {
  const line = '-'.repeat(90);
  console.log(line);
  console.log(`flxbl-actions  -- ❤️  by flxbl.io ❤️  -Version:${VERSION}`);
  console.log(line);
  console.log(`Action            : ${ACTION_NAME}`);
  console.log(`Repository        : ${inputs.repository}`);
  console.log(`Environment       : ${inputs.environment}`);
  console.log(`Release Candidates: ${inputs.releaseCandidates}`);
  console.log(`SFP Server        : ${inputs.sfpServerUrl}`);
  console.log(`Lock              : ${inputs.lock}`);
  if (inputs.excludePackages) {
    console.log(`Exclude           : ${inputs.excludePackages}`);
  }
  if (inputs.overridePackages) {
    console.log(`Override          : ${inputs.overridePackages}`);
  }
  if (inputs.dryRun) {
    console.log(`Mode              : DRY-RUN`);
  }
  console.log(line);
  console.log();
}

async function execCommand(
  command: string,
  args: string[],
  options: { silent?: boolean; ignoreReturnCode?: boolean; maxBuffer?: number } = {}
): Promise<ExecOutput> {
  let stdout = '';
  let stderr = '';

  // Limit output buffer to prevent memory issues with heavy logs
  const maxBuffer = options.maxBuffer ?? 10 * 1024 * 1024; // 10MB default
  let stdoutTruncated = false;
  let stderrTruncated = false;

  const exitCode = await exec.exec(command, args, {
    silent: options.silent ?? false,
    listeners: {
      stdout: (data: Buffer) => {
        if (!stdoutTruncated) {
          stdout += data.toString();
          if (stdout.length > maxBuffer) {
            stdout = stdout.substring(0, maxBuffer) + '\n... [output truncated]';
            stdoutTruncated = true;
          }
        }
      },
      stderr: (data: Buffer) => {
        if (!stderrTruncated) {
          stderr += data.toString();
          if (stderr.length > maxBuffer) {
            stderr = stderr.substring(0, maxBuffer) + '\n... [output truncated]';
            stderrTruncated = true;
          }
        }
      }
    },
    ignoreReturnCode: options.ignoreReturnCode ?? true
  });

  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

async function lockEnvironment(inputs: Inputs): Promise<LockResponse> {
  const args = [
    'server', 'environment', 'lock',
    '--name', inputs.environment,
    '--repository', inputs.repository,
    '--duration', inputs.lockDuration,
    '--sfp-server-url', inputs.sfpServerUrl,
    '-t', inputs.sfpServerToken,
    '--json'
  ];

  const timeoutMinutes = parseInt(inputs.lockTimeout, 10);
  if (timeoutMinutes > 0) {
    args.push('--wait-timeout', inputs.lockTimeout);
  } else {
    args.push('--wait');
  }

  core.info(`Locking environment: ${inputs.environment}`);
  core.info(`Lock duration: ${inputs.lockDuration} minutes`);
  if (timeoutMinutes > 0) {
    core.info(`Wait timeout: ${inputs.lockTimeout} minutes`);
  }

  const result = await execCommand('sfp', args, { silent: true });

  if (result.exitCode !== 0) {
    throw new Error(`Failed to lock environment: ${result.stderr || result.stdout}`);
  }

  try {
    const response = JSON.parse(result.stdout) as LockResponse;
    if (!response.ticketId) {
      throw new Error('Lock response did not contain ticket ID');
    }
    return response;
  } catch {
    throw new Error(`Failed to parse lock response: ${result.stdout}`);
  }
}

async function authDevHub(inputs: Inputs): Promise<void> {
  core.info('Authenticating to default DevHub via SFP Server...');

  const args = [
    'org', 'login',
    '--server',
    '--default-devhub',
    '--alias', inputs.devhubAlias,
    '--sfp-server-url', inputs.sfpServerUrl,
    '-t', inputs.sfpServerToken
  ];

  const result = await execCommand('sfp', args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to authenticate to DevHub: ${result.stderr || result.stdout}`);
  }

  core.info('DevHub authentication successful');
}

async function authEnvironment(inputs: Inputs): Promise<void> {
  core.info(`Authenticating to environment: ${inputs.environment}...`);

  const args = [
    'server', 'environment', 'login',
    '--name', inputs.environment,
    '--repository', inputs.repository,
    '--sfp-server-url', inputs.sfpServerUrl,
    '-t', inputs.sfpServerToken
  ];

  const result = await execCommand('sfp', args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to authenticate to environment: ${result.stderr || result.stdout}`);
  }

  core.info('Environment authentication successful');
}

/**
 * Check if release-candidates contains multiple domains (comma-separated)
 */
function isMultiDomainRelease(releaseCandidates: string): boolean {
  return releaseCandidates.includes(',');
}

/**
 * Fetch a release candidate definition from the server
 */
async function fetchReleaseCandidate(inputs: Inputs): Promise<string> {
  core.info('Fetching release candidate for modification...');

  const tempDir = os.tmpdir();
  const releaseDefFile = path.join(tempDir, `release-def-${Date.now()}.yml`);

  const args = [
    'releasecandidate', 'fetch',
    '-n', inputs.releaseCandidates,  // Now uses domain:name format
    '--repository', inputs.repository,
    '--sfp-server-url', inputs.sfpServerUrl,
    '-t', inputs.sfpServerToken,
    '-o', releaseDefFile
  ];

  const result = await execCommand('sfp', args);

  if (result.exitCode !== 0) {
    throw new Error(`Failed to fetch release candidate: ${result.stderr || result.stdout}`);
  }

  core.info(`Release definition fetched to: ${releaseDefFile}`);
  return releaseDefFile;
}

/**
 * Modify a release definition to exclude packages or override versions
 */
function modifyReleaseDefinition(
  releaseDefFile: string,
  excludePackages: string,
  overridePackages: string
): void {
  let content = fs.readFileSync(releaseDefFile, 'utf8');

  core.info('Original release definition:');
  console.log(content);

  // Process exclusions
  if (excludePackages) {
    core.info('');
    core.info(`Excluding packages: ${excludePackages}`);
    const packages = excludePackages.split(',').map(p => p.trim());
    for (const pkg of packages) {
      core.info(`  Removing: ${pkg}`);
      // Remove the package line from artifacts section
      const regex = new RegExp(`^\\s*${pkg}:.*$`, 'gm');
      content = content.replace(regex, '');
    }
  }

  // Process overrides
  if (overridePackages) {
    core.info('');
    core.info(`Overriding package versions: ${overridePackages}`);
    const overrides = overridePackages.split(',').map(o => o.trim());
    for (const override of overrides) {
      const [pkg, version] = override.split('=').map(s => s.trim());
      core.info(`  Setting ${pkg} to version ${version}`);
      // Replace the version for this package
      const regex = new RegExp(`^(\\s*)${pkg}:.*$`, 'gm');
      content = content.replace(regex, `$1${pkg}: ${version}`);
    }
  }

  // Remove empty lines created by exclusions
  content = content.replace(/^\s*[\r\n]/gm, '');

  core.info('');
  core.info('Modified release definition:');
  console.log(content);

  fs.writeFileSync(releaseDefFile, content);
}

interface DeployResult {
  success: boolean;
  changelogDir?: string;
  isDryRun: boolean;
}

const CHANGELOG_DIR = '.sfpowerscripts/changelog';

async function deployRelease(inputs: Inputs, dryRun: boolean = false, releaseDefFile?: string): Promise<DeployResult> {
  if (dryRun) {
    core.info(`DRY-RUN: Comparing release candidates ${inputs.releaseCandidates} to ${inputs.environment}...`);
  } else {
    core.info(`Deploying release candidates: ${inputs.releaseCandidates}...`);
  }

  const args: string[] = ['release', '-o', inputs.environment];

  // Use release definition file if provided (for exclude/override), otherwise use --releasecandidate
  if (releaseDefFile) {
    args.push('-p', releaseDefFile);
  } else {
    args.push('--releasecandidate', inputs.releaseCandidates);
  }

  args.push(
    '--repository', inputs.repository,
    '--sfp-server-url', inputs.sfpServerUrl,
    '-t', inputs.sfpServerToken,
    '-v', inputs.devhubAlias,
    '--waittime', inputs.waitTime
  );

  if (inputs.tag) {
    args.push('--tag', inputs.tag);
  }

  // Add changelog generation if enabled
  if (inputs.generateChangelog) {
    args.push('--generatechangelog', '-d', CHANGELOG_DIR);
  }

  // Add dry-run flag
  if (dryRun) {
    args.push('--dryrun');
  }

  const result = await execCommand('sfp', args);

  if (result.exitCode !== 0) {
    const action = dryRun ? 'Dry-run comparison' : 'Release deployment';
    core.error(`${action} failed: ${result.stderr || result.stdout}`);
    return { success: false, changelogDir: inputs.generateChangelog ? CHANGELOG_DIR : undefined, isDryRun: dryRun };
  }

  const action = dryRun ? 'Dry-run comparison' : 'Release deployment';
  core.info(`${action} completed successfully`);
  return { success: true, changelogDir: inputs.generateChangelog ? CHANGELOG_DIR : undefined, isDryRun: dryRun };
}

function printSummary(inputs: Inputs, status: string): void {
  console.log('');
  const line = '-'.repeat(90);
  console.log(line);
  console.log('Release Summary');
  console.log(line);
  console.log(`Environment       : ${inputs.environment}`);
  console.log(`Release Candidates: ${inputs.releaseCandidates}`);
  if (inputs.excludePackages) {
    console.log(`Excluded          : ${inputs.excludePackages}`);
  }
  if (inputs.overridePackages) {
    console.log(`Overrides         : ${inputs.overridePackages}`);
  }
  console.log(`Status            : ${status}`);
  console.log(line);
}

async function handleChangelog(inputs: Inputs, status: ReleaseStatus, changelogDir: string): Promise<void> {
  core.info('');
  core.info('Processing changelog...');

  try {
    // Find changelog files in the directory (may be in subdirectories per domain)
    const { markdownPath, jsonPath, content } = findChangelogFiles(changelogDir);

    // Set outputs
    if (markdownPath) {
      core.setOutput('changelog-path', markdownPath);
      core.info(`Changelog markdown: ${markdownPath}`);
    }
    if (jsonPath) {
      core.setOutput('changelog-json-path', jsonPath);
      core.info(`Changelog JSON: ${jsonPath}`);
    }

    // Post to issue if enabled
    if (inputs.updateIssue && inputs.issueNumber && content) {
      core.info(`Posting changelog to issue #${inputs.issueNumber}...`);

      try {
        // Fetch a fresh GitHub token from SFP Server
        const ghToken = await fetchGitHubToken(
          inputs.sfpServerUrl,
          inputs.sfpServerToken,
          inputs.repository
        );

        // Format the changelog with status header
        const commentBody = formatChangelogComment(
          content,
          status,
          inputs.releaseCandidates,  // Pass the full release candidates string
          inputs.environment
        );

        // Use environment in marker since we may have multiple domains
        const marker = `<!-- release-changelog:${inputs.environment} -->`;

        await upsertComment(
          ghToken,
          inputs.repository,
          inputs.issueNumber,
          commentBody,
          marker
        );

        core.info('Changelog posted to issue successfully');
      } catch (commentError) {
        core.warning(`Failed to post changelog to issue: ${commentError instanceof Error ? commentError.message : String(commentError)}`);
      }
    } else if (inputs.updateIssue && !inputs.issueNumber) {
      core.info('No issue number available, skipping comment update');
    } else if (!content) {
      core.info('No changelog content found');
    }

  } catch (error) {
    core.warning(`Failed to process changelog: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function findChangelogFiles(dir: string): { markdownPath: string | null; jsonPath: string | null; content: string | null } {
  let markdownPath: string | null = null;
  let jsonPath: string | null = null;
  let content: string | null = null;

  try {
    if (!fs.existsSync(dir)) {
      return { markdownPath, jsonPath, content };
    }

    // Collect all markdown and json files, including from subdirectories
    const allMdFiles: { path: string; mtime: number }[] = [];
    const allJsonFiles: { path: string; mtime: number }[] = [];

    function scanDir(currentDir: string): void {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.isFile()) {
          const stat = fs.statSync(fullPath);
          if (entry.name.endsWith('.md')) {
            allMdFiles.push({ path: fullPath, mtime: stat.mtime.getTime() });
          } else if (entry.name.endsWith('.json')) {
            allJsonFiles.push({ path: fullPath, mtime: stat.mtime.getTime() });
          }
        }
      }
    }

    scanDir(dir);

    // Sort by modification time (newest first)
    allMdFiles.sort((a, b) => b.mtime - a.mtime);
    allJsonFiles.sort((a, b) => b.mtime - a.mtime);

    // If multiple markdown files exist, combine them
    if (allMdFiles.length > 0) {
      markdownPath = allMdFiles[0].path;

      if (allMdFiles.length === 1) {
        content = fs.readFileSync(markdownPath, 'utf8');
      } else {
        // Combine all markdown files
        const combinedContent: string[] = [];
        for (const mdFile of allMdFiles) {
          const fileContent = fs.readFileSync(mdFile.path, 'utf8');
          combinedContent.push(fileContent);
        }
        content = combinedContent.join('\n\n---\n\n');
      }
    }

    if (allJsonFiles.length > 0) {
      jsonPath = allJsonFiles[0].path;
    }
  } catch {
    // Ignore errors
  }

  return { markdownPath, jsonPath, content };
}

export async function run(): Promise<void> {
  try {
    // Get GitHub context for auto-detecting issue number
    const ghContext = getGitHubContext();

    // Parse issue number from input or auto-detect
    const issueNumberInput = core.getInput('issue-number');
    let issueNumber: number | null = null;
    if (issueNumberInput) {
      issueNumber = parseInt(issueNumberInput, 10);
      if (isNaN(issueNumber)) {
        issueNumber = null;
      }
    } else {
      issueNumber = ghContext.issueNumber;
    }

    const inputs: Inputs = {
      sfpServerUrl: core.getInput('sfp-server-url', { required: true }),
      sfpServerToken: core.getInput('sfp-server-token', { required: true }),
      environment: core.getInput('environment', { required: true }),
      releaseCandidates: core.getInput('release-candidates', { required: true }),
      repository: core.getInput('repository') || process.env.GITHUB_REPOSITORY || '',
      devhubAlias: core.getInput('devhub-alias') || 'devhub',
      waitTime: core.getInput('wait-time') || '120',
      tag: core.getInput('tag') || '',
      excludePackages: core.getInput('exclude-packages') || '',
      overridePackages: core.getInput('override-packages') || '',
      lock: core.getInput('lock') !== 'false',
      lockTimeout: core.getInput('lock-timeout') || '120',
      lockDuration: core.getInput('lock-duration') || '120',
      dryRun: core.getInput('dry-run') === 'true',
      generateChangelog: core.getInput('generate-changelog') !== 'false',
      updateIssue: core.getInput('update-issue') !== 'false',
      issueNumber
    };

    if (!inputs.repository) {
      throw new Error('Repository not specified and GITHUB_REPOSITORY not set');
    }

    // Validate release-candidates format
    if (!inputs.releaseCandidates.includes(':')) {
      throw new Error('Invalid release-candidates format. Expected "domain:name" (e.g., "core:RC-1" or "core:RC-1,sales:RC-2")');
    }

    // Mark token as secret
    core.setSecret(inputs.sfpServerToken);

    printHeader(inputs);

    // Check if exclude/override is requested with multiple domains
    const isMultiDomain = isMultiDomainRelease(inputs.releaseCandidates);
    const needsModification = inputs.excludePackages || inputs.overridePackages;

    if (needsModification && isMultiDomain) {
      core.warning('exclude-packages and override-packages are not supported with multiple release candidates. These options will be ignored.');
    }

    // Dry-run mode - run release with --dryrun flag (no lock, no deploy, but generates changelog)
    if (inputs.dryRun) {
      core.info('DRY-RUN MODE: No lock will be acquired and no deployment will occur');

      // Still need to auth to compare against environment
      await authDevHub(inputs);
      await authEnvironment(inputs);

      // Fetch and modify release candidate if needed (single domain only)
      let releaseDefFile: string | undefined;
      if (needsModification && !isMultiDomain) {
        releaseDefFile = await fetchReleaseCandidate(inputs);
        modifyReleaseDefinition(releaseDefFile, inputs.excludePackages, inputs.overridePackages);
      }

      // Run release with --dryrun to compare and generate changelog
      const dryRunResult = await deployRelease(inputs, true, releaseDefFile);

      // Clean up temp file
      if (releaseDefFile && fs.existsSync(releaseDefFile)) {
        fs.unlinkSync(releaseDefFile);
      }

      core.setOutput('deployment-status', 'dry-run');

      // Process changelog and post to issue
      if (inputs.generateChangelog && dryRunResult.changelogDir) {
        await handleChangelog(inputs, 'dry-run', dryRunResult.changelogDir);
      }

      printSummary(inputs, 'dry-run');
      return;
    }

    // Step 1: Lock environment (if enabled)
    let ticketId: string | undefined;
    if (inputs.lock) {
      const lockResponse = await lockEnvironment(inputs);
      ticketId = lockResponse.ticketId;
      core.info(`Environment locked successfully. Ticket ID: ${ticketId}`);

      // Save state for cleanup
      core.saveState('TICKET_ID', ticketId);
      core.saveState('ENVIRONMENT', inputs.environment);
      core.saveState('REPOSITORY', inputs.repository);
      core.saveState('SFP_SERVER_URL', inputs.sfpServerUrl);
      core.saveState('SFP_SERVER_TOKEN', inputs.sfpServerToken);
      core.saveState('AUTO_UNLOCK', 'true');

      core.setOutput('ticket-id', ticketId);
    }

    // Step 2: Authenticate to DevHub
    await authDevHub(inputs);

    // Step 3: Authenticate to environment
    await authEnvironment(inputs);

    // Step 4: Fetch and modify release candidate if needed (single domain only)
    let releaseDefFile: string | undefined;
    if (needsModification && !isMultiDomain) {
      releaseDefFile = await fetchReleaseCandidate(inputs);
      modifyReleaseDefinition(releaseDefFile, inputs.excludePackages, inputs.overridePackages);
    }

    // Step 5: Deploy release (with changelog generation if enabled)
    const deployResult = await deployRelease(inputs, false, releaseDefFile);

    // Clean up temp file
    if (releaseDefFile && fs.existsSync(releaseDefFile)) {
      fs.unlinkSync(releaseDefFile);
    }

    const status = deployResult.success ? 'success' : 'failed';
    core.setOutput('deployment-status', status);

    // Process changelog and post to issue if enabled
    if (inputs.generateChangelog && deployResult.changelogDir) {
      const changelogStatus: ReleaseStatus = deployResult.success ? 'success' : 'partial';
      await handleChangelog(inputs, changelogStatus, deployResult.changelogDir);
    }

    printSummary(inputs, status);

    if (!deployResult.success) {
      core.setFailed('Release deployment failed');
    }

  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed('Unknown error occurred');
    }
  }
}

if (require.main === module) {
  run();
}
