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
exports.fetchGitHubToken = fetchGitHubToken;
const core = __importStar(require("@actions/core"));
/**
 * Fetches a fresh GitHub token from SFP Server.
 * Tokens are short-lived, so this should be called before operations that need GitHub access.
 */
async function fetchGitHubToken(serverUrl, serverToken, repository) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY = 5000;
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            core.info(`Fetching GitHub token (attempt ${attempt}/${MAX_RETRIES})...`);
            const apiUrl = new URL('/sfp/api/repository/auth-token', serverUrl);
            apiUrl.searchParams.append('repositoryIdentifier', repository);
            const response = await fetch(apiUrl.toString(), {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${serverToken}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                }
            });
            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    if (errorData.message) {
                        errorMessage = errorData.message;
                    }
                }
                catch {
                    // Use default error message
                }
                throw new Error(`Failed to get token: ${errorMessage}`);
            }
            const data = await response.json();
            if (!data.token) {
                throw new Error('Response did not contain a token');
            }
            core.setSecret(data.token);
            core.info(`GitHub token retrieved (expires: ${data.expiresAt})`);
            return data.token;
        }
        catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            core.warning(`Attempt ${attempt} failed: ${lastError.message}`);
            if (attempt < MAX_RETRIES) {
                core.info(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
                await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
            }
        }
    }
    throw new Error(`Failed to get GitHub token after ${MAX_RETRIES} attempts. Last error: ${lastError?.message || 'Unknown error'}`);
}
//# sourceMappingURL=github-token.js.map