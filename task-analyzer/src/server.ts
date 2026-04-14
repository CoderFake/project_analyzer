/**
 * Task Analyzer — MCP Server Setup
 * Registers 3 tools: setup_project, analyze_spec, analyze_project
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { analyzeProject } from './tools/analyze-project.js';
import { analyzeSpec } from './tools/analyze-spec.js';
import { setupProject } from './tools/setup-project.js';
import { log } from './utils.js';

// ─── Zod Schemas ───

const LLMConfigSchema = z.object({
  provider: z.enum(['openai', 'anthropic', 'gemini', 'ollama']),
  apiKey: z.string().describe('API key (plaintext or Fernet-encrypted)'),
  model: z.string().optional().describe('Model name (default per provider)'),
  baseUrl: z.string().optional().describe('Base URL (required for Ollama)'),
});

const SetupProjectSchema = z.object({
  repoUrl: z.string().describe('Git repository URL (GitHub/GitLab/Bitbucket)'),
  branch: z.string().describe('Branch name to checkout'),
  gitUsername: z.string().describe('Git username for PAT auth'),
  gitPat: z.string().describe('Personal Access Token (plaintext or encrypted)'),
  workspacePath: z.string().optional().describe('Custom workspace path'),
});

const AnalyzeSpecSchema = z.object({
  filePath: z.string().optional().describe('Local file path (xlsx, md, docx)'),
  url: z.string().optional().describe('URL (Redmine issue, spec page)'),
  text: z.string().optional().describe('Raw text input'),
  redmineApiKey: z.string().optional().describe('Redmine API key'),
  llm: LLMConfigSchema,
  projectId: z.string().optional().describe('Project ID from setup_project'),
  numTasks: z.number().optional().describe('Approximate number of tasks to generate'),
});

const AnalyzeProjectSchema = z.object({
  projectId: z.string().describe('Project ID from setup_project'),
  tasks: z.array(z.any()).optional().describe('Tasks from analyze_spec'),
  businessQueries: z.array(z.string()).optional().describe('Business logic queries'),
  currentIssues: z.array(z.string()).optional().describe('Current issues to analyze'),
  specText: z.string().optional().describe('Raw spec text for gap analysis'),
  llm: LLMConfigSchema,
});

// ─── Tool Definitions ───

const TOOLS = [
  {
    name: 'setup_project',
    description:
      'Clone a git repository and index it for code analysis. Supports GitHub, GitLab, Bitbucket with PAT authentication. Creates a workspace with GitNexus code index and ChromaDB embeddings.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        repoUrl: { type: 'string', description: 'Git repository URL (GitHub/GitLab/Bitbucket)' },
        branch: { type: 'string', description: 'Branch name to checkout' },
        gitUsername: { type: 'string', description: 'Git username for PAT auth' },
        gitPat: { type: 'string', description: 'Personal Access Token (plaintext or Fernet-encrypted)' },
        workspacePath: { type: 'string', description: 'Custom workspace path (optional)' },
      },
      required: ['repoUrl', 'branch', 'gitUsername', 'gitPat'],
    },
  },
  {
    name: 'analyze_spec',
    description:
      'Parse a specification document (XLSX, MD, DOCX, Redmine issue URL, or plain text) and decompose it into development tasks with business logic queries. Uses task-master for PRD parsing and PageIndex for structured document indexing.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        filePath: { type: 'string', description: 'Local file path (xlsx, md, docx)' },
        url: { type: 'string', description: 'URL (Redmine issue, spec page, etc.)' },
        text: { type: 'string', description: 'Raw text input' },
        redmineApiKey: { type: 'string', description: 'Redmine API key (if URL is Redmine)' },
        llm: {
          type: 'object',
          properties: {
            provider: { type: 'string', enum: ['openai', 'anthropic', 'gemini', 'ollama'] },
            apiKey: { type: 'string' },
            model: { type: 'string' },
            baseUrl: { type: 'string' },
          },
          required: ['provider', 'apiKey'],
        },
        projectId: { type: 'string', description: 'Project ID from setup_project' },
        numTasks: { type: 'number', description: 'Approximate number of tasks to generate' },
      },
      required: ['llm'],
    },
  },
  {
    name: 'analyze_project',
    description:
      'Full analysis pipeline using 5-agent LangGraph orchestration: Decompose → CodeMap → GapAnalysis → Impact → Report. Maps tasks to code, computes blast radius, estimates effort, and generates team questions with health scoring.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        projectId: { type: 'string', description: 'Project ID from setup_project' },
        tasks: { type: 'array', items: { type: 'object' }, description: 'Tasks from analyze_spec' },
        businessQueries: { type: 'array', items: { type: 'string' }, description: 'Business logic queries' },
        currentIssues: { type: 'array', items: { type: 'string' }, description: 'Current issues to analyze' },
        specText: { type: 'string', description: 'Raw spec text — enables gap analysis agent (spec vs code)' },
        llm: {
          type: 'object',
          properties: {
            provider: { type: 'string', enum: ['openai', 'anthropic', 'gemini', 'ollama'] },
            apiKey: { type: 'string' },
            model: { type: 'string' },
            baseUrl: { type: 'string' },
          },
          required: ['provider', 'apiKey'],
        },
      },
      required: ['projectId', 'llm'],
    },
  },
];

// ─── Create MCP Server ───

export function createServer(): Server {
  const server = new Server(
    { name: 'task-analyzer', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    try {
      let result: any;

      switch (name) {
        case 'setup_project': {
          const parsed = SetupProjectSchema.parse(args);
          result = await setupProject(parsed);
          break;
        }
        case 'analyze_spec': {
          const parsed = AnalyzeSpecSchema.parse(args);
          result = await analyzeSpec(parsed);
          break;
        }
        case 'analyze_project': {
          const parsed = AnalyzeProjectSchema.parse(args);
          result = await analyzeProject(parsed);
          break;
        }
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
      return { content: [{ type: 'text', text }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      log.error(`Tool ${name} failed: ${message}`);
      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return server;
}
