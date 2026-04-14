# Task Analyzer — MCP Server

Unified MCP server that orchestrates **GitNexus** (code intelligence) and **Task-Master** (task management) through a LangGraph 5-agent pipeline for spec-driven project analysis.

## Architecture

```
Client (AI Agent)
  │
  │ HTTP POST /mcp (JSON-RPC)
  ▼
┌────────────────────────────────────────────┐
│  Task Analyzer MCP (Streamable HTTP)       │
│                                            │
│  Tool 1: setup_project                     │
│    → git clone → gitnexus analyze → embed  │
│                                            │
│  Tool 2: analyze_spec                      │
│    → parse spec → task-master parse-prd    │
│    → LLM decompose → business queries     │
│                                            │
│  Tool 3: analyze_project                   │
│    → LangGraph 5-agent pipeline:           │
│      Decompose → CodeMap → GapAnalysis     │
│      → Impact → Report                    │
│    → healthScore + estimates + questions   │
└────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
    GitNexus CLI        Task-Master CLI
    (subprocess)         (subprocess)
```

## Prerequisites

- **Node.js** ≥ 20.19.0 (required for `rolldown` native bindings in task-master)
- **npm** ≥ 10
- **Git** (for `setup_project` tool)

## Project Structure

```
task-analyzer/
├── src/
│   ├── index.ts          # HTTP entry point (Express + MCP SDK)
│   ├── server.ts         # MCP tool registrations (3 tools)
│   ├── utils.ts          # Bootstrap, exec, workspace, decrypt, ENV resolvers
│   ├── types.ts          # Shared TypeScript types
│   ├── agents/           # LangGraph 5-agent pipeline
│   │   ├── graph.ts      # StateGraph builder
│   │   ├── state.ts      # Shared state schema
│   │   ├── decompose.ts  # Agent 1: tasks → modules/APIs/keywords
│   │   ├── code-map.ts   # Agent 2: ChromaDB ∥ GitNexus search
│   │   ├── gap-analysis.ts # Agent 3: spec vs code (conditional)
│   │   ├── impact.ts     # Agent 4: blast radius + estimation
│   │   └── report.ts     # Agent 5: health score + recommendations
│   ├── core/             # Service integrations
│   │   ├── gitnexus.ts   # GitNexus CLI wrapper
│   │   ├── taskmaster.ts # Task-Master CLI wrapper
│   │   ├── chromadb.ts   # Vector store
│   │   ├── llm.ts        # LangChain multi-provider (OpenAI/Anthropic/Gemini/Ollama)
│   │   ├── git.ts        # Git clone/pull operations
│   │   ├── parsers.ts    # Spec parsers (xlsx/docx/md/redmine/url)
│   │   └── pageindex.ts  # PageIndex tree generator
│   └── tools/            # MCP tool handlers
│       ├── setup-project.ts
│       ├── analyze-spec.ts
│       └── analyze-project.ts
├── package.json
├── tsconfig.json
└── .env.example
```

## Installation & Setup

### 1. Clone monorepo

```bash
git clone <repo-url> project_analyzer
cd project_analyzer
```

### 2. Install & build task-analyzer

```bash
cd task-analyzer
npm install
cp .env.example .env   # Edit with your credentials
npm run build
```

### 3. Start server

```bash
npm start
# Or for development:
npm run dev
```

On first start, `bootstrap()` automatically:
1. Installs `gitnexus-shared` dependencies
2. Installs + builds `gitnexus` (includes shared compilation)
3. Installs + builds `task-master`

Bootstrap is **idempotent** — skips modules already built.

## Bootstrap Flow

```
Server starts → bootstrap()
  │
  ├── gitnexus: node_modules? → npm install (--ignore-scripts)
  │   └── preInstall: gitnexus-shared/node_modules? → npm install
  │   └── dist/cli/index.js? → clean tsbuildinfo → npm run build
  │
  └── task-master: node_modules? → npm install
      └── dist/task-master.js? → npm run build
```

> **Note:** `gitnexus` uses `--ignore-scripts` to prevent premature builds.
> `task-master` runs scripts normally (rolldown needs postinstall for native bindings).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/mcp` | MCP JSON-RPC requests |
| GET | `/mcp` | SSE stream (server-initiated) |
| DELETE | `/mcp` | Close session |
| GET | `/health` | Health check |

## MCP Tools

All tools resolve credentials from **ENV variables** by default. Override per-request via tool call arguments.

### `setup_project`

Clone + index a git repository.

**Input:**
```json
{
  "repoUrl": "https://github.com/org/repo",
  "branch": "develop",
  "gitUsername": "user",
  "gitPat": "ghp_xxx"
}
```
> `gitUsername` and `gitPat` are optional if `GIT_USERNAME` and `GIT_PAT` env are set.

**Output:** `{ projectId, localPath, stats: { files, symbols, edges } }`

---

### `analyze_spec`

Parse specification → tasks + business queries.

**Input:**
```json
{
  "filePath": "/path/to/spec.xlsx",
  "projectId": "abc123",
  "numTasks": 15,
  "llm": {
    "provider": "gemini",
    "apiKey": "AIza...",
    "model": "gemini-2.5-flash"
  }
}
```
> `llm` is optional if `LLM_PROVIDER` and `LLM_API_KEY` env are set.

Supports: `.xlsx`, `.docx`, `.md`, Redmine URL, plain text.

**Output:** `{ tasks[], businessQueries[], specSummary, sourceType }`

---

### `analyze_project`

5-agent LangGraph analysis pipeline.

**Input:**
```json
{
  "projectId": "abc123",
  "tasks": [],
  "businessQueries": [],
  "specText": "raw spec..."
}
```
> `llm` is optional if `LLM_PROVIDER` and `LLM_API_KEY` env are set.

**Output:**
```json
{
  "codebaseOverview": { "totalFiles", "topModules", "complexityHotspots" },
  "taskAnalysis": [
    {
      "task": { "id", "title", "..." },
      "relevantCode": { "files", "symbols" },
      "impact": { "directlyAffected", "indirectlyAffected", "risk" },
      "estimate": { "codeHours", "testHours", "totalHours", "confidence" }
    }
  ],
  "questionsForTeam": [],
  "summary": { "totalEstimatedHours", "highRiskTasks", "recommendations" }
}
```

## LangGraph Pipeline

```
START → Decompose → CodeMap → [GapAnalysis?] → Impact → Report → END
          (LLM)    (DB∥CLI)     (LLM)       (CLI+LLM)  (LLM)
```

| Agent | Input | Output | Engine |
|-------|-------|--------|--------|
| Decompose | tasks[] | decomposedUnits[] (modules, APIs, keywords) | LLM |
| CodeMap | decomposedUnits[], businessQueries[] | codeMap[] (files, symbols per task) | ChromaDB ∥ GitNexus |
| GapAnalysis | tasks[], codeMap[], specText | gaps[] (missing, conflicts, deps) | LLM (conditional) |
| Impact | tasks[], codeMap[], gaps[] | taskAnalyses[] (blast radius, estimate) | GitNexus CLI + LLM |
| Report | taskAnalyses[], gaps[] | healthScore, questions, recommendations | LLM + rules |

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `PORT` | No | `3100` | HTTP server port |
| `HOST` | No | `0.0.0.0` | Bind address |
| `LLM_PROVIDER` | Yes | — | `openai` \| `anthropic` \| `gemini` \| `ollama` |
| `LLM_API_KEY` | Yes | — | LLM provider API key |
| `LLM_MODEL` | No | per-provider | Model name |
| `LLM_BASE_URL` | No | — | Custom base URL (required for Ollama) |
| `GIT_USERNAME` | No | — | Git username for PAT auth |
| `GIT_PAT` | No | — | Personal Access Token |
| `ENCRYPTION_KEY` | No | — | Fernet key for credential decryption |
| `DEBUG` | No | — | Enable verbose logging |

## Troubleshooting

### `rolldown-binding.darwin-*.node` not found
Node.js version too old. Task-master requires **≥ 20.19.0**.
```bash
nvm install 20  # or nvm install --lts
```

### `gitnexus-shared` module not found during build
Stale TypeScript build cache. Bootstrap automatically cleans `tsconfig.tsbuildinfo`.
If manual fix needed:
```bash
rm -f git-nexus/gitnexus-shared/tsconfig.tsbuildinfo
rm -f git-nexus/gitnexus/tsconfig.tsbuildinfo
cd git-nexus/gitnexus && npm run build
```

### Bootstrap timeout
Default timeout is 5 minutes per module. For slow networks:
```bash
npm config set fetch-timeout 600000
```
