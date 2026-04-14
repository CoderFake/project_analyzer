# Project Analyzer

Monorepo containing 3 modules for automated project analysis via MCP (Model Context Protocol):

| Module | Role |
|--------|------|
| **task-analyzer** | Main MCP Server — orchestrator |
| **git-nexus** | Code intelligence engine (subprocess) |
| **task-master** | Task management engine (subprocess) |

## Quick Start

```bash
cd task-analyzer
npm install
cp .env.example .env   # Edit with your credentials
npm run build
npm start
```

On first startup, `bootstrap()` automatically installs and builds `git-nexus` and `task-master` from source.

---

## Connect MCP Client

Each user configures their own credentials via `env` in `mcpServers`:

### Full Config (recommended)

```json
{
  "mcpServers": {
    "task-analyzer": {
      "command": "node",
      "args": ["<path>/project_analyzer/task-analyzer/dist/index.js"],
      "env": {
        "PORT": "3100",
        "LLM_PROVIDER": "gemini",
        "LLM_API_KEY": "AIzaSy...",
        "LLM_MODEL": "gemini-2.5-flash",
        "GIT_USERNAME": "your-username",
        "GIT_PAT": "ghp_xxxxxxxxxxxx"
      }
    }
  }
}
```

### ENV Variables

| ENV | Required | Description |
|-----|----------|-------------|
| `PORT` | No | Server port (default: 3100) |
| `LLM_PROVIDER` | Yes | `openai` \| `anthropic` \| `gemini` \| `ollama` |
| `LLM_API_KEY` | Yes | LLM provider API key |
| `LLM_MODEL` | No | Model name (defaults per provider) |
| `LLM_BASE_URL` | No | Custom base URL (required for Ollama) |
| `GIT_USERNAME` | Yes* | Git username (*only for `setup_project`) |
| `GIT_PAT` | Yes* | Personal Access Token (*only for `setup_project`) |
| `ENCRYPTION_KEY` | No | Fernet key for encrypting credentials |

> **Note:** ENV values can be overridden per-request via tool call arguments.

### Remote Server (Streamable HTTP)

```json
{
  "mcpServers": {
    "task-analyzer": {
      "url": "https://your-server.com/mcp"
    }
  }
}
```

---

## Available Tools

### 1. `setup_project`
Clone + index a git repository for code analysis.

```json
{
  "repoUrl": "https://github.com/org/repo",
  "branch": "develop"
}
```
> Git credentials resolved from ENV. Override with `gitUsername` / `gitPat` in args.

### 2. `analyze_spec`
Parse specification (XLSX/DOCX/MD/Redmine/URL/text) into tasks + business queries.

```json
{
  "filePath": "/path/to/spec.xlsx",
  "projectId": "abc123",
  "numTasks": 15
}
```
> LLM config resolved from ENV. Override with `llm: { provider, apiKey, model }` in args.
>
> Supported providers: `openai`, `anthropic`, `gemini`, `ollama`

### 3. `analyze_project`
5-agent LangGraph pipeline: Decompose → CodeMap → GapAnalysis → Impact → Report.

```json
{
  "projectId": "abc123",
  "tasks": [],
  "businessQueries": [],
  "specText": "..."
}
```

**Output:** Health score, time estimates, blast radius, team questions, recommendations.

---

## Health Check

```bash
curl http://localhost:3100/health
```

```json
{
  "status": "ok",
  "version": "1.1.0",
  "transport": "streamable-http",
  "sessions": 0,
  "uptime": 123.45
}
```

---

## Requirements

- **Node.js** ≥ 20.19.0
- **npm** ≥ 10
- **Git** (for `setup_project`)

## Project Structure

```
project_analyzer/
├── task-analyzer/    ← MCP Server (Streamable HTTP :3100)
├── git-nexus/        ← Code intelligence (auto-built by task-analyzer)
└── task-master/      ← Task management (auto-built by task-analyzer)
```

See [task-analyzer/README.md](task-analyzer/README.md) for detailed technical documentation.
