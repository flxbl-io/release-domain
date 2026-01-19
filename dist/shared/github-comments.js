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
exports.findComment = findComment;
exports.upsertComment = upsertComment;
const core = __importStar(require("@actions/core"));
const github_context_1 = require("./github-context");
/**
 * Finds a comment in an issue/PR by a marker string.
 * The marker should be an HTML comment like <!-- marker:unique-id -->
 */
async function findComment(token, repository, issueNumber, marker) {
    const { owner, repo } = (0, github_context_1.parseRepository)(repository);
    const apiUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
    try {
        let page = 1;
        const perPage = 100;
        while (true) {
            const response = await fetch(`${apiUrl}?page=${page}&per_page=${perPage}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'X-GitHub-Api-Version': '2022-11-28'
                }
            });
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Failed to fetch comments: HTTP ${response.status}: ${errorText}`);
            }
            const comments = await response.json();
            if (comments.length === 0) {
                break;
            }
            for (const comment of comments) {
                if (comment.body && comment.body.includes(marker)) {
                    return comment.id;
                }
            }
            if (comments.length < perPage) {
                break;
            }
            page++;
        }
        return null;
    }
    catch (error) {
        core.warning(`Error finding comment: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}
/**
 * Creates or updates a comment on an issue/PR.
 * Uses a marker to identify existing comments for updates.
 */
async function upsertComment(token, repository, issueNumber, body, marker) {
    const { owner, repo } = (0, github_context_1.parseRepository)(repository);
    // Include the marker at the beginning of the body
    const bodyWithMarker = `${marker}\n${body}`;
    // Try to find existing comment
    const existingCommentId = await findComment(token, repository, issueNumber, marker);
    if (existingCommentId) {
        // Update existing comment
        const updateUrl = `https://api.github.com/repos/${owner}/${repo}/issues/comments/${existingCommentId}`;
        const response = await fetch(updateUrl, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ body: bodyWithMarker })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to update comment: HTTP ${response.status}: ${errorText}`);
        }
        core.info(`Updated existing comment #${existingCommentId}`);
    }
    else {
        // Create new comment
        const createUrl = `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`;
        const response = await fetch(createUrl, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ body: bodyWithMarker })
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Failed to create comment: HTTP ${response.status}: ${errorText}`);
        }
        const result = await response.json();
        core.info(`Created new comment #${result.id}`);
    }
}
//# sourceMappingURL=github-comments.js.map