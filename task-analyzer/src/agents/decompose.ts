/**
 * Agent 1: Decompose
 *
 * Input:  tasks[]
 * Output: decomposedUnits[] (modules, APIs, keywords per task)
 *
 * Uses LLM to break high-level tasks into searchable implementation units.
 */

import { callLLMJson } from '../core/llm.js';
import { log } from '../utils.js';
import type { AnalysisStateType, DecomposedUnit } from './state.js';

export async function decomposeAgent(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  log.info(`[Decompose] ${state.tasks.length} tasks → implementation units`);

  if (!state.tasks?.length) {
    return { decomposedUnits: [] };
  }

  const taskSummary = state.tasks
    .map((t) => `- [${t.id}] ${t.title}: ${t.description}`)
    .join('\n');

  try {
    const result = await callLLMJson<{ units: DecomposedUnit[] }>(state.llm, [
      {
        role: 'system',
        content: `You are a senior architect. For each task, identify:
- modules: which code modules/packages are likely affected
- apis: which API endpoints or interfaces are involved
- keywords: search terms to find relevant code

Return JSON: { "units": [{ "taskId", "taskTitle", "modules": [], "apis": [], "keywords": [] }] }`,
      },
      {
        role: 'user',
        content: `Decompose:\n${taskSummary}`,
      },
    ]);

    log.info(`[Decompose] Produced ${result.units?.length ?? 0} units`);
    return { decomposedUnits: result.units ?? [] };
  } catch (err) {
    log.warn(`[Decompose] LLM failed, using keyword fallback: ${err}`);
    return {
      decomposedUnits: state.tasks.map((t) => ({
        taskId: t.id,
        taskTitle: t.title,
        modules: [],
        apis: [],
        keywords: t.title.toLowerCase().split(/\s+/).filter((w) => w.length > 2),
      })),
    };
  }
}
