"use strict";
/**
 * GitHub context utilities for extracting information from GitHub Actions environment
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGitHubContext = getGitHubContext;
exports.parseRepository = parseRepository;
/**
 * Extracts GitHub context from environment variables.
 * Works in GitHub Actions environment.
 */
function getGitHubContext() {
    const repository = process.env.GITHUB_REPOSITORY || '';
    const [owner, repo] = repository.split('/');
    // Extract issue/PR number from various GitHub event contexts
    let issueNumber = null;
    // Try to get from GITHUB_REF for PR events (refs/pull/123/merge)
    const ref = process.env.GITHUB_REF || '';
    const prMatch = ref.match(/refs\/pull\/(\d+)/);
    if (prMatch) {
        issueNumber = parseInt(prMatch[1], 10);
    }
    // Try to get from GITHUB_EVENT_PATH for issue events
    if (!issueNumber && process.env.GITHUB_EVENT_PATH) {
        try {
            const fs = require('fs');
            const eventPath = process.env.GITHUB_EVENT_PATH;
            if (fs.existsSync(eventPath)) {
                const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
                // Check for issue number in various event payloads
                if (event.issue?.number) {
                    issueNumber = event.issue.number;
                }
                else if (event.pull_request?.number) {
                    issueNumber = event.pull_request.number;
                }
                else if (event.number) {
                    issueNumber = event.number;
                }
            }
        }
        catch {
            // Ignore errors reading event file
        }
    }
    return {
        issueNumber,
        repository,
        owner: owner || '',
        repo: repo || '',
        ref,
        sha: process.env.GITHUB_SHA || '',
        eventName: process.env.GITHUB_EVENT_NAME || ''
    };
}
/**
 * Parses a repository string into owner and repo parts.
 */
function parseRepository(repository) {
    const [owner, repo] = repository.split('/');
    return { owner: owner || '', repo: repo || '' };
}
//# sourceMappingURL=github-context.js.map