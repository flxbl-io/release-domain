"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateChangelog = generateChangelog;
exports.formatChangelogComment = formatChangelogComment;
const core = __importStar(require("@actions/core"));
const exec = __importStar(require("@actions/exec"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
/**
 * Generates a changelog using the sfp changelog from-env command.
 */
async function generateChangelog(options) {
    const outputDir = options.outputDir || '.sfpowerscripts/outputs';
    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
    }
    const releaseName = `${options.domain}:${options.releaseCandidate}`;
    const args = [
        'changelog', 'from-env',
        '-u', options.environment,
        '-n', releaseName,
        '--repository', options.repository,
        '--output', outputDir,
        '--sfp-server-url', options.serverUrl,
        '-t', options.serverToken
    ];
    core.info(`Generating changelog for ${releaseName} in ${options.environment}...`);
    let stdout = '';
    let stderr = '';
    try {
        const exitCode = await exec.exec('sfp', args, {
            silent: false,
            listeners: {
                stdout: (data) => {
                    stdout += data.toString();
                },
                stderr: (data) => {
                    stderr += data.toString();
                }
            },
            ignoreReturnCode: true
        });
        if (exitCode !== 0) {
            core.warning(`Changelog generation returned exit code ${exitCode}`);
            return {
                success: false,
                markdownPath: null,
                jsonPath: null,
                content: null,
                error: stderr || stdout || `Exit code: ${exitCode}`
            };
        }
        // Look for generated files
        const markdownPath = findChangelogFile(outputDir, '.md');
        const jsonPath = findChangelogFile(outputDir, '.json');
        let content = null;
        if (markdownPath && fs.existsSync(markdownPath)) {
            content = fs.readFileSync(markdownPath, 'utf8');
        }
        core.info(`Changelog generated successfully`);
        if (markdownPath)
            core.info(`  Markdown: ${markdownPath}`);
        if (jsonPath)
            core.info(`  JSON: ${jsonPath}`);
        return {
            success: true,
            markdownPath,
            jsonPath,
            content
        };
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        core.warning(`Failed to generate changelog: ${errorMessage}`);
        return {
            success: false,
            markdownPath: null,
            jsonPath: null,
            content: null,
            error: errorMessage
        };
    }
}
/**
 * Finds the most recent changelog file in a directory.
 */
function findChangelogFile(dir, extension) {
    try {
        if (!fs.existsSync(dir)) {
            return null;
        }
        const files = fs.readdirSync(dir)
            .filter(f => f.toLowerCase().includes('changelog') && f.endsWith(extension))
            .map(f => ({
            name: f,
            path: path.join(dir, f),
            mtime: fs.statSync(path.join(dir, f)).mtime.getTime()
        }))
            .sort((a, b) => b.mtime - a.mtime);
        return files.length > 0 ? files[0].path : null;
    }
    catch {
        return null;
    }
}
/**
 * Formats a changelog as a GitHub comment with status header.
 * @param content - The markdown changelog content
 * @param status - The release status
 * @param releaseCandidates - Release candidates in format "domain:name" or "domain1:name1,domain2:name2"
 * @param environment - Target environment name
 */
function formatChangelogComment(content, status, releaseCandidates, environment) {
    const statusEmoji = getStatusEmoji(status);
    const statusText = getStatusText(status);
    const timestamp = new Date().toISOString();
    return `## ${statusEmoji} Release ${statusText}

**Environment:** \`${environment}\`
**Release Candidates:** \`${releaseCandidates}\`
**Updated:** ${timestamp}

---

${content}

---
<sub>Generated by flxbl-actions/release-domains</sub>`;
}
function getStatusEmoji(status) {
    switch (status) {
        case 'success':
            return '\u2705'; // green check
        case 'partial':
            return '\u26a0\ufe0f'; // warning
        case 'failed':
            return '\u274c'; // red x
        case 'dry-run':
            return '\ud83d\udcdd'; // memo
        default:
            return '\u2139\ufe0f'; // info
    }
}
function getStatusText(status) {
    switch (status) {
        case 'success':
            return 'Completed Successfully';
        case 'partial':
            return 'Partially Completed';
        case 'failed':
            return 'Failed';
        case 'dry-run':
            return 'Dry Run Preview';
        default:
            return 'Status Unknown';
    }
}
//# sourceMappingURL=changelog.js.map