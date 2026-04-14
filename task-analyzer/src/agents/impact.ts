/**
 * Agent 4: Impact + Estimation
 *
 * Input:  tasks[], codeMap[], gaps[]
 * Output: taskAnalyses[] (impact + time estimate per task)
 *
 * Uses GitNexus blast radius + LLM estimation with full gap context.
 */

import * as gitnexus from '../core/gitnexus.js';
import { callLLMJson } from '../core/llm.js';
import type {
  AnalyzedTask,
  ImpactResult,
  LLMConfig,
  Task,
  TimeEstimate,
} from '../types.js';
import { log } from '../utils.js';
import type { AnalysisStateType, CodeMapEntry, GapResult } from './state.js';

export async function impactAgent(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  log.info(`[Impact] Computing blast radius + estimates for ${state.tasks.length} tasks`);

  const results: AnalyzedTask[] = [];

  for (const task of state.tasks) {
    const code = state.codeMap.find((c) => c.taskId === task.id);
    const gap = state.gaps.find((g) => g.taskId === task.id);

    const impact = await computeImpact(state.projectId, code, gap);
    const estimate = await computeEstimate(state.llm, task, code, gap, impact);

    results.push({
      task,
      relevantCode: {
        files: code?.files ?? [],
        symbols: code?.symbols ?? [],
        modules: [],
        executionFlows: [],
      },
      impact,
      estimate,
      openQuestions: gap?.missingInCode ?? [],
    });
  }

  return { taskAnalyses: results };
}

// ─── Blast Radius via GitNexus ───

async function computeImpact(
  projectId: string,
  code: CodeMapEntry | undefined,
  gap: GapResult | undefined
): Promise<ImpactResult> {
  const defaults: ImpactResult = {
    directlyAffected: 0,
    indirectlyAffected: 0,
    risk: 'LOW',
    affectedProcesses: [],
  };

  if (!code?.symbols?.length) return defaults;

  try {
    const gnImpact = await gitnexus.impact(projectId, code.symbols[0]);
    const impact: ImpactResult = {
      directlyAffected: gnImpact?.summary?.directCallers ?? 0,
      indirectlyAffected: gnImpact?.summary?.totalAffected ?? 0,
      risk: gnImpact?.risk ?? 'LOW',
      affectedProcesses: gnImpact?.affected_processes?.map((p: any) => p.name) ?? [],
    };

    // Elevate risk based on gap severity
    if (gap) {
      const conflicts = gap.conflictsWithExisting.length;
      if (conflicts >= 3 && impact.risk === 'LOW') impact.risk = 'MEDIUM';
      if (conflicts >= 5 && impact.risk !== 'CRITICAL') impact.risk = 'HIGH';
    }

    return impact;
  } catch {
    return defaults;
  }
}

// ─── Time Estimation via LLM ───

async function computeEstimate(
  llm: LLMConfig,
  task: Task,
  code: CodeMapEntry | undefined,
  gap: GapResult | undefined,
  impact: ImpactResult
): Promise<TimeEstimate> {
  try {
    const result = await callLLMJson<TimeEstimate>(llm, [
      {
        role: 'system',
        content: `You are a senior tech lead estimating development time.
Consider files affected, gap severity, blast radius, and testing needs.
Return JSON: { "codeHours", "testHours", "reviewHours", "totalHours", "confidence": "low"|"medium"|"high", "assumptions": [] }`,
      },
      {
        role: 'user',
        content: `TASK: ${task.title}
DESCRIPTION: ${task.description}
COMPLEXITY: ${task.complexity ?? 'unknown'}/10

CODE: ${code?.files?.length ?? 0} files, ${code?.symbols?.length ?? 0} symbols
GAPS: ${gap?.missingInCode?.length ?? 0} missing, ${gap?.conflictsWithExisting?.length ?? 0} conflicts
DEPS: ${gap?.dependencies?.join(', ') || 'none'}
BLAST RADIUS: ${impact.directlyAffected} direct, ${impact.indirectlyAffected} indirect, risk=${impact.risk}`,
      },
    ]);

    return {
      codeHours: result.codeHours ?? 4,
      testHours: result.testHours ?? 2,
      reviewHours: result.reviewHours ?? 1,
      totalHours: result.totalHours ?? 7,
      confidence: result.confidence ?? 'medium',
      assumptions: result.assumptions ?? [],
    };
  } catch {
    // Deterministic fallback based on complexity
    const c = task.complexity ?? 5;
    const codeH = c * 2;
    const testH = c;
    const reviewH = Math.ceil(c / 2);
    return {
      codeHours: codeH,
      testHours: testH,
      reviewHours: reviewH,
      totalHours: codeH + testH + reviewH,
      confidence: 'low',
      assumptions: ['Fallback: no LLM response, estimated from complexity score'],
    };
  }
}
