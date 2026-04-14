/**
 * Tool 2: analyze_spec — Parse spec → Tasks + Business Queries
 */

import { join } from 'path';
import { callLLMJson } from '../core/llm.js';
import * as pageindex from '../core/pageindex.js';
import { parseInput } from '../core/parsers.js';
import * as taskmaster from '../core/taskmaster.js';
import type { AnalyzeSpecInput, SpecAnalysisResult, Task } from '../types.js';
import { decryptIfNeeded, getWorkspace, log } from '../utils.js';

export async function analyzeSpec(input: AnalyzeSpecInput): Promise<SpecAnalysisResult> {
  // Decrypt LLM API key once
  const llm = {
    ...input.llm,
    apiKey: decryptIfNeeded(input.llm.apiKey),
  };

  // Step 1: Parse input to text
  const parsed = await parseInput({
    filePath: input.filePath,
    url: input.url,
    text: input.text,
    redmineApiKey: input.redmineApiKey ? decryptIfNeeded(input.redmineApiKey) : undefined,
  });

  log.info(`Spec parsed: ${parsed.sourceType}, ${parsed.text.length} chars`);

  // Step 2: Try task-master for decomposition
  let tasks: Task[] = [];
  let docsPath: string | undefined;

  if (input.projectId) {
    try {
      const workspace = getWorkspace(input.projectId);
      docsPath = workspace.docsPath;
    } catch { /* no project setup yet */ }
  }

  if (docsPath) {
    try {
      const result = await taskmaster.parsePRD(parsed.text, docsPath, {
        numTasks: input.numTasks,
        projectRoot: docsPath,
      });
      tasks = result.tasks.map(mapTask);
      log.info(`task-master generated ${tasks.length} tasks`);
    } catch (err) {
      log.warn(`task-master failed, using LLM fallback: ${err}`);
    }
  }

  // Step 3: LLM fallback if task-master didn't produce results
  if (tasks.length === 0) {
    tasks = await decomposeTasks(llm, parsed.text, input.numTasks);
    log.info(`LLM generated ${tasks.length} tasks`);
  }

  // Step 4: Generate PageIndex tree (if we have a docs path)
  if (docsPath && parsed.sourceType !== 'text') {
    try {
      await pageindex.generateTree(
        input.filePath ?? join(docsPath, 'parsed', 'spec_input.md'),
        join(docsPath, 'pageindex')
      );
    } catch (err) {
      log.warn(`PageIndex tree generation skipped: ${err}`);
    }
  }

  // Step 5: Generate business queries from tasks
  const businessQueries = await generateBusinessQueries(llm, tasks, parsed.text);

  // Step 6: Summarize spec
  const specSummary = await summarizeSpec(llm, parsed.text);

  return {
    tasks,
    businessQueries,
    specSummary,
    sourceType: parsed.sourceType,
  };
}

// ─── LLM: Decompose spec into tasks ───
async function decomposeTasks(
  llm: any,
  specText: string,
  numTasks?: number
): Promise<Task[]> {
  const targetCount = numTasks ?? 0;

  const result = await callLLMJson<{ tasks: Task[] }>(llm, [
    {
      role: 'system',
      content: 'You are an expert project manager. Decompose specs into actionable development tasks. Return JSON.',
    },
    {
      role: 'user',
      content: `Analyze this specification and decompose it into development tasks.
${targetCount > 0 ? `Target approximately ${targetCount} tasks.` : 'Determine the appropriate number of tasks based on complexity.'}

Return JSON format:
{
  "tasks": [
    {
      "id": "1",
      "title": "...",
      "description": "...",
      "priority": "low|medium|high|critical",
      "complexity": 1-10,
      "acceptanceCriteria": ["..."]
    }
  ]
}

SPECIFICATION:
${specText.slice(0, 30000)}`,
    },
  ]);

  return result.tasks ?? [];
}

// ─── LLM: Generate business queries ───
async function generateBusinessQueries(
  llm: any,
  tasks: Task[],
  specText: string
): Promise<string[]> {
  const taskSummary = tasks
    .map((t) => `- ${t.title}: ${t.description}`)
    .join('\n');

  const result = await callLLMJson<{ queries: string[] }>(llm, [
    {
      role: 'system',
      content: 'You generate code search queries to understand how a codebase relates to spec requirements. Return JSON.',
    },
    {
      role: 'user',
      content: `Given these tasks and the original spec, generate business logic queries.
These queries will be used to search the codebase and understand what code is affected.

TASKS:
${taskSummary}

SPEC EXCERPT:
${specText.slice(0, 10000)}

Return JSON:
{
  "queries": [
    "Where is user authentication implemented?",
    "What API endpoints handle order processing?",
    "How does the notification system work?"
  ]
}

Generate 5-15 specific, actionable queries.`,
    },
  ]);

  return result.queries ?? [];
}

// ─── LLM: Summarize spec ───
async function summarizeSpec(llm: any, specText: string): Promise<string> {
  const { callLLM } = await import('../core/llm.js');
  const response = await callLLM(llm, [
    {
      role: 'system',
      content: 'Summarize the following spec in 3-5 sentences. Focus on scope, key features, and constraints.',
    },
    {
      role: 'user',
      content: specText.slice(0, 20000),
    },
  ]);

  return response.content;
}

// ─── Helper ───
function mapTask(raw: any): Task {
  return {
    id: String(raw.id),
    title: raw.title ?? '',
    description: raw.description ?? '',
    priority: raw.priority ?? 'medium',
    complexity: raw.complexity ?? undefined,
    acceptanceCriteria: raw.acceptanceCriteria ?? [],
    subtasks: raw.subtasks?.map(mapTask),
  };
}
