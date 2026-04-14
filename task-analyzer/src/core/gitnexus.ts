/**
 * GitNexus Wrapper — uses locally-built gitnexus binary
 *
 * Calls: node <monorepo>/git-nexus/gitnexus/dist/cli/index.js
 * NOT: npx -y gitnexus@latest (slow, needs network)
 */

import type { CodebaseStats } from '../types.js';
import { bootstrap, exec, getModuleBin, log } from '../utils.js';

/**
 * Analyze and index a repository with GitNexus.
 */
export async function analyzeRepo(repoPath: string): Promise<CodebaseStats> {
  await bootstrap(); // Ensure gitnexus is built
  const { cmd, prefix } = getModuleBin('gitnexus');

  log.info(`GitNexus analyzing: ${repoPath}`);

  const { stdout } = await exec(cmd, [...prefix, 'analyze', repoPath], {
    timeout: 300_000,
  });

  return parseStats(stdout);
}

/**
 * Query the code knowledge graph for execution flows.
 */
export async function query(
  repo: string,
  queryText: string
): Promise<{ processes: any[]; symbols: any[] }> {
  await bootstrap();
  const { cmd, prefix } = getModuleBin('gitnexus');

  log.debug(`GitNexus query: "${queryText}" (repo: ${repo})`);

  try {
    const { stdout } = await exec(cmd, [
      ...prefix,
      'mcp',
      '--tool', 'query',
      '--repo', repo,
      '--query', queryText,
    ], { timeout: 60_000 });

    return JSON.parse(stdout);
  } catch (err) {
    log.warn(`GitNexus query failed: ${err}`);
    return { processes: [], symbols: [] };
  }
}

/**
 * Get 360-degree context for a symbol.
 */
export async function context(
  repo: string,
  symbolName: string
): Promise<any> {
  await bootstrap();
  const { cmd, prefix } = getModuleBin('gitnexus');

  log.debug(`GitNexus context: "${symbolName}" (repo: ${repo})`);

  try {
    const { stdout } = await exec(cmd, [
      ...prefix,
      'mcp',
      '--tool', 'context',
      '--repo', repo,
      '--name', symbolName,
    ], { timeout: 60_000 });

    return JSON.parse(stdout);
  } catch (err) {
    log.warn(`GitNexus context failed for ${symbolName}: ${err}`);
    return null;
  }
}

/**
 * Analyze blast radius of changing a symbol.
 */
export async function impact(
  repo: string,
  target: string,
  direction: 'upstream' | 'downstream' = 'upstream'
): Promise<any> {
  await bootstrap();
  const { cmd, prefix } = getModuleBin('gitnexus');

  log.debug(`GitNexus impact: "${target}" ${direction} (repo: ${repo})`);

  try {
    const { stdout } = await exec(cmd, [
      ...prefix,
      'mcp',
      '--tool', 'impact',
      '--repo', repo,
      '--target', target,
      '--direction', direction,
    ], { timeout: 60_000 });

    return JSON.parse(stdout);
  } catch (err) {
    log.warn(`GitNexus impact failed for ${target}: ${err}`);
    return { risk: 'UNKNOWN', affected: 0 };
  }
}

// ─── Parse GitNexus output ───
function parseStats(output: string): CodebaseStats {
  const getNum = (pattern: RegExp): number => {
    const match = output.match(pattern);
    return match ? parseInt(match[1], 10) : 0;
  };

  return {
    files: getNum(/(\d+)\s*files?/i),
    symbols: getNum(/(\d+)\s*symbols?/i),
    edges: getNum(/(\d+)\s*edges?/i),
    modules: getNum(/(\d+)\s*(?:modules?|communit)/i),
    processes: getNum(/(\d+)\s*process/i),
  };
}
