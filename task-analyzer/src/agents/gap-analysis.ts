/**
 * Agent 3: Gap Analysis (conditional — only runs if specText is provided)
 *
 * Input:  tasks[], codeMap[], specText
 * Output: gaps[] (missing, conflicts, dependencies per task)
 *
 * Adversarial reviewer: compares spec requirements vs existing code.
 */

import { callLLMJson } from '../core/llm.js';
import { log } from '../utils.js';
import type { AnalysisStateType, GapResult } from './state.js';

export async function gapAnalysisAgent(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  log.info(`[GapAnalysis] Analyzing ${state.tasks.length} tasks against spec`);

  const gaps: GapResult[] = [];

  for (const task of state.tasks) {
    const code = state.codeMap.find((c) => c.taskId === task.id);
    const codeContext = formatCodeContext(code);

    try {
      const result = await callLLMJson<GapResult>(state.llm, [
        {
          role: 'system',
          content: `You are an adversarial code reviewer. Compare the spec requirements against existing code to find:
1. missingInCode: what the spec requires but code doesn't have
2. conflictsWithExisting: where new requirements clash with existing behavior
3. dependencies: what must be done first (DB migrations, API changes, etc.)

Return JSON: { "taskId": "...", "missingInCode": [], "conflictsWithExisting": [], "dependencies": [] }`,
        },
        {
          role: 'user',
          content: `TASK: ${task.title}
DESCRIPTION: ${task.description}
ACCEPTANCE CRITERIA: ${task.acceptanceCriteria?.join('; ') ?? 'none specified'}

EXISTING CODE:
${codeContext}

SPEC:
${state.specText.slice(0, 6000)}`,
        },
      ]);

      gaps.push({ ...result, taskId: task.id });
    } catch {
      gaps.push({
        taskId: task.id,
        missingInCode: [],
        conflictsWithExisting: [],
        dependencies: [],
      });
    }
  }

  const totalGaps = gaps.reduce(
    (s, g) => s + g.missingInCode.length + g.conflictsWithExisting.length,
    0
  );
  log.info(`[GapAnalysis] Found ${totalGaps} total gaps/conflicts`);

  return { gaps };
}

// ─── Helper ───

function formatCodeContext(code: { files: string[]; symbols: string[] } | undefined): string {
  if (!code || (!code.files.length && !code.symbols.length)) {
    return 'No matching code found in codebase.';
  }
  const parts: string[] = [];
  if (code.files.length) {
    parts.push(`Files (${code.files.length}): ${code.files.slice(0, 15).join(', ')}`);
  }
  if (code.symbols.length) {
    parts.push(`Symbols (${code.symbols.length}): ${code.symbols.slice(0, 15).join(', ')}`);
  }
  return parts.join('\n');
}
