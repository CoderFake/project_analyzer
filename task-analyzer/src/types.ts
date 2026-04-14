/**
 * Task Analyzer — Shared Types
 */

// ─── LLM Config ───
export interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'gemini' | 'ollama';
  apiKey: string;
  model?: string;
  baseUrl?: string; // Required for Ollama, optional for OpenAI-compatible
}

// ─── Git ───
export type GitProvider = 'github' | 'gitlab' | 'bitbucket';

export interface SetupProjectInput {
  repoUrl: string;
  branch: string;
  gitUsername: string;
  gitPat: string;
  workspacePath?: string;
}

export interface ProjectInfo {
  projectId: string;
  localPath: string;
  docsPath: string;
  stats: CodebaseStats;
  topModules: string[];
  status: 'indexed';
}

export interface CodebaseStats {
  files: number;
  symbols: number;
  edges: number;
  modules: number;
  processes: number;
}

// ─── Spec / Tasks ───
export type SpecSourceType = 'xlsx' | 'md' | 'docx' | 'redmine' | 'url' | 'text';

export interface AnalyzeSpecInput {
  filePath?: string;
  url?: string;
  text?: string;
  redmineApiKey?: string;
  llm: LLMConfig;
  projectId?: string;
  numTasks?: number;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  complexity?: number;
  acceptanceCriteria?: string[];
  subtasks?: Task[];
}

export interface SpecAnalysisResult {
  tasks: Task[];
  businessQueries: string[];
  specSummary: string;
  sourceType: SpecSourceType;
}

// ─── Project Analysis ───
export interface AnalyzeProjectInput {
  projectId: string;
  tasks?: Task[];
  businessQueries?: string[];
  currentIssues?: string[];
  specText?: string;
  llm: LLMConfig;
}

export interface RelevantCode {
  files: string[];
  symbols: string[];
  modules: string[];
  executionFlows: string[];
}

export interface ImpactResult {
  directlyAffected: number;
  indirectlyAffected: number;
  risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  affectedProcesses: string[];
}

export interface TimeEstimate {
  codeHours: number;
  testHours: number;
  reviewHours: number;
  totalHours: number;
  confidence: 'low' | 'medium' | 'high';
  assumptions: string[];
}

export interface AnalyzedTask {
  task: Task;
  relevantCode: RelevantCode;
  impact: ImpactResult;
  estimate: TimeEstimate;
  openQuestions: string[];
}

export interface Question {
  question: string;
  context: string;
  relatedTask: string;
  priority: 'must-answer' | 'nice-to-have';
}

export interface ProjectAnalysisResult {
  codebaseOverview: {
    totalFiles: number;
    topModules: { name: string; symbols: number }[];
    complexityHotspots: string[];
  };
  taskAnalysis: AnalyzedTask[];
  questionsForTeam: Question[];
  summary: {
    totalEstimatedHours: number;
    highRiskTasks: string[];
    recommendations: string[];
  };
}
