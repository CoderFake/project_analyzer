/**
 * Tool 1: setup_project — Clone repo + GitNexus index + ChromaDB embed
 */

import { join } from 'path';
import * as chromadb from '../core/chromadb.js';
import { cloneRepo, detectProvider } from '../core/git.js';
import * as gitnexus from '../core/gitnexus.js';
import type { ProjectInfo, SetupProjectInput } from '../types.js';
import { createWorkspace, decryptIfNeeded, log } from '../utils.js';

export async function setupProject(input: SetupProjectInput): Promise<ProjectInfo> {
  const pat = decryptIfNeeded(input.gitPat);

  // Create workspace
  const workspace = createWorkspace();
  const { projectId, repoPath, docsPath } = workspace;

  log.info(`Project ${projectId}: setting up workspace`);

  // Step 1: Clone repo
  await cloneRepo(input.repoUrl, input.branch, repoPath, input.gitUsername, pat);

  // Step 2: GitNexus analyze
  let stats = { files: 0, symbols: 0, edges: 0, modules: 0, processes: 0 };
  let topModules: string[] = [];

  try {
    stats = await gitnexus.analyzeRepo(repoPath);
    log.info(`GitNexus indexed: ${stats.files} files, ${stats.symbols} symbols`);
  } catch (err) {
    log.warn(`GitNexus analyze failed: ${err}. Continuing without code index.`);
  }

  // Step 3: ChromaDB — embed basic file listing for fast retrieval
  try {
    const { readdirSync, statSync } = await import('fs');
    const files = collectFiles(repoPath, repoPath);
    const docs = files.map((f) => ({
      id: f.path,
      text: `File: ${f.path} (${f.ext})`,
      metadata: { path: f.path, ext: f.ext },
    }));

    const chromaPath = join(docsPath, '.chroma');
    await chromadb.storeCodeContext(chromaPath, projectId, docs);
  } catch (err) {
    log.warn(`ChromaDB embed failed: ${err}`);
  }

  return {
    projectId,
    localPath: repoPath,
    docsPath,
    stats,
    topModules,
    status: 'indexed',
  };
}

// ─── Helpers ───
interface FileInfo {
  path: string;
  ext: string;
}

function collectFiles(dir: string, rootDir: string, maxFiles = 5000): FileInfo[] {
  const { readdirSync, statSync } = require('fs');
  const { relative, extname, join: pathJoin } = require('path');

  const files: FileInfo[] = [];
  const skipDirs = new Set(['node_modules', '.git', 'dist', 'build', '__pycache__', '.next', 'vendor']);

  function walk(currentDir: string) {
    if (files.length >= maxFiles) return;

    try {
      const entries = readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (files.length >= maxFiles) break;

        if (entry.isDirectory()) {
          if (!skipDirs.has(entry.name) && !entry.name.startsWith('.')) {
            walk(pathJoin(currentDir, entry.name));
          }
        } else if (entry.isFile()) {
          const ext = extname(entry.name);
          const rel = relative(rootDir, pathJoin(currentDir, entry.name));
          files.push({ path: rel, ext });
        }
      }
    } catch { /* skip unreadable dirs */ }
  }

  walk(dir);
  return files;
}
