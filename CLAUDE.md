# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

```bash
# Install all dependencies (frontend + backend)
make install

# Run both frontend and backend concurrently
make dev

# Run only backend (LangGraph dev server on :2024)
make dev-backend

# Run only frontend (Next.js on :3000, connects to remote LangGraph API)
make dev-frontend

# Run frontend pointing to local backend (:2024)
make dev-local

# Backend linting/formatting
uv run ruff check src/ tests/
uv run ruff format src/ tests/

# Backend type checking
uv run mypy src/

# Frontend linting
cd frontend && bun run lint

# Frontend build
cd frontend && bun run build

# Run all tests
uv run pytest

# Run a single test file
uv run pytest tests/unit/test_check_links_async.py

# Run a single test by name
uv run pytest -k "test_name"
```

## Architecture

A multi-agent AI assistant platform with a **LangGraph + Python backend** and a **Next.js frontend**. Uses `uv` for Python and `bun` for Node.js throughout.

### Backend (Python)

The backend runs as two coordinated services defined in `langgraph.json`:

1. **LangGraph Server** — The agent graph runtime (port 2024). Entry point is `src/agent/generic_agent.py:generic_agent`. Manages conversation state, tool execution, and streaming.

2. **FastAPI Sidecar** — REST API (mounted via `langgraph.json` `http.app`). Entry point is `src/api/server.py:app` which re-exports from `src/api/fastapi_app.py:app`. Handles CRUD for agent profiles, knowledge bases, skills, MCP servers, user auth, document uploads, model listing proxy, LangSmith trace sharing, and voice WebSocket proxy.

**Two agent graphs:**
- `generic_agent` (`src/agent/generic_agent.py`) — The primary production agent. Configured per-request via `config["configurable"]` with system prompt, enabled tools, model, agent_id, etc. Uses `context_schema=GenericAgentContext` for typed runtime config (system_prompt, enabled_tools, agent_id, agent_ids, model, user_preferences, safety_enabled).
- `docs_agent` (`src/agent/docs_graph.py`) — A specialized LangChain documentation assistant. Pulls its system prompt from LangSmith Prompt Hub (or local file with `USE_LOCAL_PROMPTS=true`).

**Shared config** lives in `src/agent/config.py` — initializes the OpenAI-compatible `ChatOpenAI` model, middleware stack, and env var reading. `NEXT_PUBLIC_OPENAI_BASE_URL` / `API_KEY` are backend-only; the frontend fetches the model list via the FastAPI `/api/models` proxy (the key stays server-side).

**Middleware stack** (applied to agents via `langchain.agents`):
- `SummarizationMiddleware` — auto-summarizes context at 130k tokens, keeps 30k
- `DynamicConfigMiddleware` (`src/middleware/dynamic_config_middleware.py`) — the key middleware. Intercepts model calls to inject per-request system prompts, filter tools, create dynamic subagent tools (`call_agent_*`), inject MCP tools, and switch models at runtime. Reads agent profiles, skills, and linked subagents from the database. Caches subagent tools per agent_id to avoid redundant DB queries.
- `ModelRetryMiddleware` / `ToolRetryMiddleware` — retry logic for model and tool failures
- `ModelFallbackMiddleware` — fallback to default model on failures

**Tools** (`src/tools/`):
- `rag_tool.py` — LanceDB-backed RAG search. Each agent/KB gets its own LanceDB table. Uses async-native LanceDB API + OpenAI embeddings. Supports `ingest_documents_async` and `delete_documents_async`.
- `fetch_tool.py` — URL fetching
- `skill_tool.py` — `read_skill` tool to load custom skill content from DB (always available, even when filtered)
- `mcp_tools.py` — Dynamic MCP (Model Context Protocol) tool integration via `src/utils/mcp.py` McpPoolManager
- `link_check_tools.py`, `pricing_tools.py` — docs-agent-specific tools
- `redis.py` — In-memory cache with TTL (RedisCache class, despite the name)

**Database**: SQLAlchemy ORM in `src/utils/db.py`. Uses PostgreSQL (via `DATABASE_URL`) in production, falls back to local SQLite (`chat_langchain.db`) for development. Tables: `agent_profiles`, `knowledge_bases`, `skills`, `mcp_servers`, `users`, `client_profiles`. Schema migrations are done via `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` in the FastAPI lifespan handler (not a migration tool).

**Voice Proxy** (`src/api/voice_proxy.py`): WebSocket endpoints `/ws/voice/asr` and `/ws/voice/tts` that proxy to DashScope Realtime API. `DASHSCOPE_API_KEY` stays server-side.

### Frontend (Next.js)

Next.js 16 + React 19 in `frontend/`. Uses Tailwind CSS v4 + Radix UI (shadcn/ui pattern in `components/ui/`). Turbopack enabled via `next.config.ts`.

- `app/` — Next.js App Router (single-page chat UI)
- `components/chat/` — Chat interface, message rendering, input
- `components/layout/` — Sidebar, header, agent profiles dialog, management dashboard, auth dialog, user profile
- `components/providers/` — React context providers
- `lib/api/` — API client code (LangGraph SDK wrapper, LangSmith client)
- `lib/hooks/` — Custom React hooks organized by domain: `agents/`, `auth/`, `chat/`, `files/`, `threads/`
- `lib/i18n/` — Internationalization
- `lib/types/` — TypeScript type definitions
- `lib/config/`, `lib/constants/` — App configuration and constants

Communicates with the backend via the LangGraph SDK (`@langchain/langgraph-sdk`) for streaming agent responses and the FastAPI REST API for CRUD operations.

### Auth

`src/api/auth.py` implements LangGraph's auth framework. Optional `LANGGRAPH_AUTH_SECRET` env var gates access via `X-Auth-Key` header. User identity comes from `Authorization: Bearer <user_id>`. LangGraph Studio users are detected automatically and bypass restrictions. The FastAPI sidecar has its own user auth system (`/api/auth/register`, `/api/auth/login`) with PBKDF2 password hashing.

## Environment Variables

See `.env.example` for the full list. Key points:
- `NEXT_PUBLIC_OPENAI_BASE_URL`, `NEXT_PUBLIC_OPENAI_API_KEY` — backend-only. The FastAPI sidecar proxies `/api/models` so the API key never reaches the browser. Supports any OpenAI-compatible endpoint (OpenAI, Ollama, OpenRouter, vLLM, DashScope).
- `NEXT_PUBLIC_OPENAI_DEFAULT_MODEL` — used by both frontend (fallback) and backend.
- `DATABASE_URL` — PostgreSQL connection string. Falls back to SQLite if unset.
- `LANCEDB_PATH` — Where LanceDB vector stores live (default `/tmp/lancedb_agents`).
- `OPENAI_EMBEDDING_MODEL` — Embedding model name (default `text-embedding-v4`, 1024 dims).
- `LANGSMITH_API_KEY` / `LANGSMITH_PROJECT` — Tracing via LangSmith. Use `CHAT_LANGCHAIN_LANGSMITH_API_KEY` on LangGraph Cloud to avoid reserved name conflicts.
- `DASHSCOPE_API_KEY` — Required for voice features (ASR/TTS WebSocket proxy).
- `OPENAI_GUARDRAILS_MODEL` — Optional separate model for guardrails (defaults to main model).
