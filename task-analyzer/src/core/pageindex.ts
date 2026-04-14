/**
 * PageIndex Wrapper — Python subprocess for vectorless doc retrieval
 */

import { existsSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { exec, log } from '../utils.js';

/**
 * Generate a PageIndex tree structure from a document.
 * Requires Python3 with pageindex installed.
 */
export async function generateTree(
  inputPath: string,
  outputDir: string,
  options?: { model?: string }
): Promise<any> {
  const model = options?.model ?? 'gpt-4o-2024-11-20';

  log.info(`PageIndex: generating tree for ${inputPath}`);

  // Check if pageindex is installed
  try {
    await exec('python3', ['-c', 'import pageindex']);
  } catch {
    log.warn('PageIndex not installed. Skipping tree generation.');
    log.warn('Install: pip3 install -r path/to/PageIndex/requirements.txt');
    return null;
  }

  const script = `
import json
from pageindex import page_index

result = page_index(
    doc="${inputPath}",
    model="${model}",
    max_pages_per_node=10,
    if_add_node_summary="yes",
    if_add_node_id="yes"
)

print(json.dumps(result, ensure_ascii=False, indent=2))
`;

  try {
    const { stdout } = await exec('python3', ['-c', script], {
      timeout: 300_000, // 5 min for large docs
    });

    const tree = JSON.parse(stdout);

    // Save tree to output dir
    const treePath = join(outputDir, 'tree_structure.json');
    writeFileSync(treePath, JSON.stringify(tree, null, 2), 'utf-8');

    log.info(`PageIndex tree saved: ${treePath}`);
    return tree;
  } catch (err) {
    log.warn(`PageIndex tree generation failed: ${err}`);
    return null;
  }
}

/**
 * Retrieve relevant sections from a PageIndex tree.
 * Uses LLM reasoning over the tree structure.
 */
export async function retrieve(
  treePath: string,
  query: string,
  llmModel?: string
): Promise<string[]> {
  if (!existsSync(treePath)) {
    log.warn(`PageIndex tree not found: ${treePath}`);
    return [];
  }

  const model = llmModel ?? 'gpt-4o-2024-11-20';

  const script = `
import json
from pageindex.retrieve import retrieve_from_tree

tree = json.load(open("${treePath}"))
results = retrieve_from_tree(tree, "${query.replace(/"/g, '\\"')}", model="${model}")

print(json.dumps(results, ensure_ascii=False))
`;

  try {
    const { stdout } = await exec('python3', ['-c', script], {
      timeout: 60_000,
    });
    return JSON.parse(stdout);
  } catch (err) {
    log.warn(`PageIndex retrieval failed: ${err}`);
    return [];
  }
}

/**
 * Load a previously generated tree structure.
 */
export async function loadTree(docsPath: string): Promise<any | null> {
  const treePath = join(docsPath, 'pageindex', 'tree_structure.json');
  if (!existsSync(treePath)) return null;

  const data = await readFile(treePath, 'utf-8');
  return JSON.parse(data);
}
