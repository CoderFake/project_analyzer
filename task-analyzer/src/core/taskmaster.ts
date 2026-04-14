/**
 * Task Master Wrapper — uses locally-built task-master binary
 *
 * Calls: node <monorepo>/task-master/dist/task-master.js
 * NOT: npx -y task-master-ai (slow, needs network)
 */

import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { bootstrap, exec, getModuleBin, log } from '../utils.js';

/**
 * Parse a PRD/spec file into tasks using task-master.
 * Writes spec text to temp file, calls task-master parse-prd.
 */
export async function parsePRD(
  specText: string,
  docsPath: string,
  options?: { numTasks?: number; projectRoot?: string }
): Promise<{ tasks: any[]; outputPath: string }> {
  await bootstrap(); // Ensure task-master is built
  const { cmd, prefix } = getModuleBin('taskmaster');

  // Write spec to temp file in .docs/parsed/
  const specPath = join(docsPath, 'parsed', 'spec_input.md');
  writeFileSync(specPath, specText, 'utf-8');

  const outputPath = join(docsPath, 'output', 'tasks.json');
  const projectRoot = options?.projectRoot ?? docsPath;

  log.info(`task-master parsing spec: ${specPath}`);

  const args = [
    ...prefix,
    'parse-prd',
    '--input', specPath,
    '--output', outputPath,
    '--force',
  ];

  if (options?.numTasks && options.numTasks > 0) {
    args.push('--num-tasks', String(options.numTasks));
  }

  try {
    await exec(cmd, args, {
      cwd: projectRoot,
      timeout: 180_000,
    });

    // Read generated tasks
    const tasksData = JSON.parse(readFileSync(outputPath, 'utf-8'));

    return {
      tasks: tasksData.tasks ?? [],
      outputPath,
    };
  } catch (err) {
    log.warn(`task-master parse-prd failed: ${err}`);
    return { tasks: [], outputPath };
  }
}
