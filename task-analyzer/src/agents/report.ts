/**
 * Agent 5: Report
 *
 * Input:  taskAnalyses[], gaps[]
 * Output: questionsForTeam[], report (ProjectAnalysisResult)
 *
 * Generates: team questions, health score, recommendations, execution plan.
 */

import { callLLMJson } from '../core/llm.js';
import type {
  AnalyzedTask,
  LLMConfig,
  ProjectAnalysisResult,
  Question,
} from '../types.js';
import { log } from '../utils.js';
import type { AnalysisStateType, GapResult } from './state.js';

export async function reportAgent(
  state: AnalysisStateType
): Promise<Partial<AnalysisStateType>> {
  log.info('[Report] Generating final report');

  const { taskAnalyses, gaps, llm } = state;

  const questionsForTeam = await generateQuestions(llm, taskAnalyses, gaps);
  const healthScore = calculateHealthScore(taskAnalyses, gaps);
  const recommendations = buildRecommendations(taskAnalyses, gaps, healthScore);

  const totalHours = taskAnalyses.reduce((s, a) => s + a.estimate.totalHours, 0);
  const highRiskTasks = taskAnalyses
    .filter((a) => a.impact.risk === 'HIGH' || a.impact.risk === 'CRITICAL')
    .map((a) => a.task.title);

  const report: ProjectAnalysisResult = {
    codebaseOverview: {
      totalFiles: new Set(taskAnalyses.flatMap((a) => a.relevantCode.files)).size,
      topModules: [],
      complexityHotspots: highRiskTasks,
    },
    taskAnalysis: taskAnalyses,
    questionsForTeam,
    summary: {
      totalEstimatedHours: Math.round(totalHours * 10) / 10,
      highRiskTasks,
      recommendations,
    },
  };

  log.info(`[Report] Health: ${healthScore}/100, Est: ${Math.round(totalHours)}h, Questions: ${questionsForTeam.length}`);
  return { questionsForTeam, report };
}

// ─── LLM: Team Questions ───

async function generateQuestions(
  llm: LLMConfig,
  analyses: AnalyzedTask[],
  gaps: GapResult[]
): Promise<Question[]> {
  const lines = analyses.map((a) => {
    const g = gaps.find((g) => g.taskId === a.task.id);
    return `- [${a.impact.risk}] ${a.task.title} (${a.estimate.totalHours}h) — gaps:${g?.missingInCode?.length ?? 0} conflicts:${g?.conflictsWithExisting?.length ?? 0}`;
  });

  try {
    const result = await callLLMJson<{ questions: Question[] }>(llm, [
      {
        role: 'system',
        content: `Senior tech lead generating must-answer questions before project kickoff.
Focus on: ambiguities, blockers, missing info, risk areas.
Return JSON: { "questions": [{ "question", "context", "relatedTask", "priority": "must-answer"|"nice-to-have" }] }`,
      },
      {
        role: 'user',
        content: `Analysis summary:\n${lines.join('\n')}\n\nGenerate 5-10 critical questions.`,
      },
    ]);
    return result.questions ?? [];
  } catch {
    return [];
  }
}

// ─── Health Score (0-100) ───

function calculateHealthScore(analyses: AnalyzedTask[], gaps: GapResult[]): number {
  let score = 100;

  for (const a of analyses) {
    const riskPenalty = { CRITICAL: 15, HIGH: 8, MEDIUM: 3, LOW: 0 };
    score -= riskPenalty[a.impact.risk] ?? 0;
    if (a.estimate.confidence === 'low') score -= 5;
  }

  for (const g of gaps) {
    score -= g.conflictsWithExisting.length * 5;
    score -= g.missingInCode.length * 2;
  }

  return Math.max(0, Math.min(100, score));
}

// ─── Recommendations ───

function buildRecommendations(
  analyses: AnalyzedTask[],
  gaps: GapResult[],
  healthScore: number
): string[] {
  const recs: string[] = [];

  if (healthScore < 50) {
    recs.push(`🔴 Health ${healthScore}/100 — significant risks, consider phased rollout`);
  } else if (healthScore < 75) {
    recs.push(`🟡 Health ${healthScore}/100 — moderate risks, address HIGH items first`);
  } else {
    recs.push(`🟢 Health ${healthScore}/100 — project looks healthy`);
  }

  const criticals = analyses.filter((a) => a.impact.risk === 'CRITICAL');
  if (criticals.length) {
    recs.push(`⚠️ ${criticals.length} CRITICAL task(s) — review blast radius first`);
  }

  const conflicts = gaps.reduce((s, g) => s + g.conflictsWithExisting.length, 0);
  if (conflicts) {
    recs.push(`🔧 ${conflicts} code conflict(s) — resolve before implementation`);
  }

  const lowConf = analyses.filter((a) => a.estimate.confidence === 'low');
  if (lowConf.length) {
    recs.push(`📊 ${lowConf.length} low-confidence estimate(s) — spike/prototype first`);
  }

  const total = analyses.reduce((s, a) => s + a.estimate.totalHours, 0);
  if (total > 160) {
    recs.push(`📅 Total ${Math.round(total)}h (${Math.round(total / 8)}d) — split into sprints`);
  }

  return recs;
}
