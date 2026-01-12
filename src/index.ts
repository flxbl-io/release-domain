import * as core from '@actions/core';
import * as exec from '@actions/exec';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const VERSION = '1.0.0';
const ACTION_NAME = 'release-domain';

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
  releaseCandidate: string;
  domain: string;
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
}

function printHeader(inputs: Inputs): void {
  const line = '-'.repeat(90);
  console.log(line);
  console.log(`flxbl-actions  -- ❤️  by flxbl.io ❤️  -Version:${VERSION}`);
  console.log(line);
  console.log(`Action        : ${ACTION_NAME}`);
  console.log(`Repository    : ${inputs.repository}`);
  console.log(`Environment   : ${inputs.environment}`);
  console.log(`Release Candidate: ${inputs.releaseCandidate}`);
  console.log(`Domain        : ${inputs.domain}`);
  console.log(`SFP Server    : ${inputs.sfpServerUrl}`);
  console.log(`Lock          : ${inputs.lock}`);
  if (inputs.excludePackages) {
    console.log(`Exclude       : ${inputs.excludePackages}`);
  }
  if (inputs.overridePackages) {
    console.log(`Override      : ${inputs.overridePackages}`);
  }
  if (inputs.dryRun) {
    console.log(`Mode          : DRY-RUN`);
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

async function fetchReleaseCandidate(inputs: Inputs): Promise<string> {
  core.info('Fetching release candidate for modification...');

  const tempDir = os.tmpdir();
  const releaseDefFile = path.join(tempDir, `release-def-${Date.now()}.yml`);

  const args = [
    'releasecandidate', 'fetch',
    '-n', inputs.releaseCandidate,
    '-c', inputs.domain,
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

async function deployRelease(inputs: Inputs, releaseDefFile?: string): Promise<boolean> {
  core.info(`Deploying release candidate: ${inputs.releaseCandidate} (domain: ${inputs.domain})...`);

  const args: string[] = ['release', '-o', inputs.environment];

  if (releaseDefFile) {
    args.push('-p', releaseDefFile);
  } else {
    args.push(
      '--releasecandidate', inputs.releaseCandidate,
      '--releasecandidatedomain', inputs.domain
    );
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

  const result = await execCommand('sfp', args);

  if (result.exitCode !== 0) {
    core.error(`Release deployment failed: ${result.stderr || result.stdout}`);
    return false;
  }

  core.info('Release deployment completed successfully');
  return true;
}

function printSummary(inputs: Inputs, status: string): void {
  console.log('');
  const line = '-'.repeat(90);
  console.log(line);
  console.log('Release Summary');
  console.log(line);
  console.log(`Environment   : ${inputs.environment}`);
  console.log(`Release       : ${inputs.releaseCandidate}`);
  console.log(`Domain        : ${inputs.domain}`);
  if (inputs.excludePackages) {
    console.log(`Excluded      : ${inputs.excludePackages}`);
  }
  if (inputs.overridePackages) {
    console.log(`Overrides     : ${inputs.overridePackages}`);
  }
  console.log(`Status        : ${status}`);
  console.log(line);
}

export async function run(): Promise<void> {
  try {
    const inputs: Inputs = {
      sfpServerUrl: core.getInput('sfp-server-url', { required: true }),
      sfpServerToken: core.getInput('sfp-server-token', { required: true }),
      environment: core.getInput('environment', { required: true }),
      releaseCandidate: core.getInput('release-candidate', { required: true }),
      domain: core.getInput('domain', { required: true }),
      repository: core.getInput('repository') || process.env.GITHUB_REPOSITORY || '',
      devhubAlias: core.getInput('devhub-alias') || 'devhub',
      waitTime: core.getInput('wait-time') || '120',
      tag: core.getInput('tag') || '',
      excludePackages: core.getInput('exclude-packages') || '',
      overridePackages: core.getInput('override-packages') || '',
      lock: core.getInput('lock') !== 'false',
      lockTimeout: core.getInput('lock-timeout') || '120',
      lockDuration: core.getInput('lock-duration') || '120',
      dryRun: core.getInput('dry-run') === 'true'
    };

    if (!inputs.repository) {
      throw new Error('Repository not specified and GITHUB_REPOSITORY not set');
    }

    // Mark token as secret
    core.setSecret(inputs.sfpServerToken);

    printHeader(inputs);

    // Dry-run mode
    if (inputs.dryRun) {
      core.info('DRY-RUN MODE: No lock will be acquired and no deployment will occur');
      core.setOutput('deployment-status', 'dry-run');
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

    // Step 4: Fetch and modify release candidate if needed
    let releaseDefFile: string | undefined;
    if (inputs.excludePackages || inputs.overridePackages) {
      releaseDefFile = await fetchReleaseCandidate(inputs);
      modifyReleaseDefinition(releaseDefFile, inputs.excludePackages, inputs.overridePackages);
    }

    // Step 5: Deploy release
    const success = await deployRelease(inputs, releaseDefFile);

    // Clean up temp file
    if (releaseDefFile && fs.existsSync(releaseDefFile)) {
      fs.unlinkSync(releaseDefFile);
    }

    const status = success ? 'success' : 'failed';
    core.setOutput('deployment-status', status);

    printSummary(inputs, status);

    if (!success) {
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
