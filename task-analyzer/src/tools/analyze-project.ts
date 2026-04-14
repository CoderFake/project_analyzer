/**
 * Tool 3: analyze_project — MCP tool handler (thin wrapper)
 *
 * 1. Receives encrypted LLM config from client
 * 2. Decrypts API key (Fernet) ONCE
 * 3. Invokes LangGraph analysis pipeline
 * 4. Returns ProjectAnalysisResult
 */

import { join } from 'path';
import { getAnalysisGraph } from '../agents/graph.js';
import type { AnalyzeProjectInput, LLMConfig, ProjectAnalysisResult } from '../types.js';
import { decryptIfNeeded, getWorkspace, log } from '../utils.js';

export async function analyzeProject(input: AnalyzeProjectInput): Promise<ProjectAnalysisResult> {
  // Step 1: Resolve workspace
  const workspace = getWorkspace(input.projectId);
  const chromaPath = join(workspace.docsPath, '.chroma');

  // Step 2: Decrypt LLM config ONCE — all agents receive decrypted version
  const llm: LLMConfig = {
    provider: input.llm.provider,
    apiKey: decryptIfNeeded(input.llm.apiKey),
    model: input.llm.model,
    baseUrl: input.llm.baseUrl,
  };

  log.info(`[analyze_project] Provider: ${llm.provider}, Model: ${llm.model ?? 'default'}`);
  log.info(`[analyze_project] Tasks: ${input.tasks?.length ?? 0}, Queries: ${input.businessQueries?.length ?? 0}`);

  // Step 3: Invoke LangGraph pipeline
  const graph = getAnalysisGraph();

  const result = await graph.invoke({
    // Inputs
    projectId: input.projectId,
    chromaPath,
    llm,
    tasks: input.tasks ?? [],
    businessQueries: input.businessQueries ?? [],
    specText: input.specText ?? '',

    // Initialize empty (agents will fill these)
    decomposedUnits: [],
    codeMap: [],
    gaps: [],
    taskAnalyses: [],
    questionsForTeam: [],
    report: null,
  });

  if (!result.report) {
    throw new Error('Analysis pipeline completed but produced no report');
  }

  return result.report;
}
