/**
 * Shared LangGraph State Annotation + Internal Types
 *
 * State flows through all agent nodes. LLM config is decrypted
 * ONCE at graph entry, then reused by every agent.
 */

import { Annotation } from '@langchain/langgraph';
import type {
  AnalyzedTask,
  LLMConfig,
  ProjectAnalysisResult,
  Question,
  Task,
} from '../types.js';

// ─── Internal agent types ───

export interface DecomposedUnit {
  taskId: string;
  taskTitle: string;
  modules: string[];
  apis: string[];
  keywords: string[];
}

export interface CodeMapEntry {
  taskId: string;
  files: string[];
  symbols: string[];
}

export interface GapResult {
  taskId: string;
  missingInCode: string[];
  conflictsWithExisting: string[];
  dependencies: string[];
}

// ─── State Annotation ───

export const AnalysisState = Annotation.Root({
  // ── Inputs (set once at graph entry) ──
  projectId: Annotation<string>,
  chromaPath: Annotation<string>,
  llm: Annotation<LLMConfig>,            // Decrypted config — agents use this directly
  tasks: Annotation<Task[]>,
  businessQueries: Annotation<string[]>,
  specText: Annotation<string>,

  // ── Agent outputs (accumulated through pipeline) ──
  decomposedUnits: Annotation<DecomposedUnit[]>,
  codeMap: Annotation<CodeMapEntry[]>,
  gaps: Annotation<GapResult[]>,
  taskAnalyses: Annotation<AnalyzedTask[]>,
  questionsForTeam: Annotation<Question[]>,
  report: Annotation<ProjectAnalysisResult | null>,
});

/** Convenience type alias */
export type AnalysisStateType = typeof AnalysisState.State;
