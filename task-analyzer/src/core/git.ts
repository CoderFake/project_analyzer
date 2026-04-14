/**
 * Git Clone — Supports GitHub, GitLab, Bitbucket with PAT auth
 */

import type { GitProvider } from '../types.js';
import { exec, log } from '../utils.js';

/**
 * Detect git provider from URL.
 */
export function detectProvider(repoUrl: string): GitProvider {
  const url = new URL(repoUrl);
  if (url.host.includes('gitlab')) return 'gitlab';
  if (url.host.includes('bitbucket')) return 'bitbucket';
  return 'github';
}

/**
 * Build authenticated clone URL.
 */
function buildCloneUrl(repoUrl: string, username: string, pat: string): string {
  const url = new URL(repoUrl);
  const provider = detectProvider(repoUrl);

  // GitLab uses oauth2 as username for PAT
  url.username = provider === 'gitlab' ? 'oauth2' : username;
  url.password = pat;

  // Ensure .git suffix
  if (!url.pathname.endsWith('.git')) {
    url.pathname += '.git';
  }

  return url.toString();
}

/**
 * Clone a repository and checkout the target branch.
 */
export async function cloneRepo(
  repoUrl: string,
  branch: string,
  targetDir: string,
  username: string,
  pat: string
): Promise<void> {
  const provider = detectProvider(repoUrl);
  const cloneUrl = buildCloneUrl(repoUrl, username, pat);

  log.info(`Cloning ${provider} repo: ${repoUrl} (branch: ${branch})`);

  // Clone with depth for speed (full history not needed for analysis)
  await exec('git', [
    'clone',
    '--branch', branch,
    '--depth', '1',
    '--single-branch',
    cloneUrl,
    targetDir,
  ]);

  log.info(`Clone complete: ${targetDir}`);
}
