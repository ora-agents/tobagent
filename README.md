# TOB Agent

[中文文档](README.zh-CN.md)

TOB Agent is a business-oriented LangGraph agent platform. It combines a configurable agent runtime, a Next.js management and chat UI, knowledge-base RAG, reusable skills, structured forms, MCP server configuration, voice interaction, and a Tauri desktop shell.

The backend is built with LangGraph/Aegra and FastAPI. The frontend is built with Next.js, React, TypeScript, Tailwind CSS, and Radix UI. The runtime works with OpenAI-compatible model APIs, including OpenAI, Ollama, OpenRouter, vLLM, and other services that expose a `/v1`-compatible interface.

## Features

- **Configurable agents**: manage system prompts, models, tools, knowledge bases, skills, forms, MCP servers, wake words, TTS voices, and speaker profiles per agent.
- **LangGraph runtime**: includes the `generic_agent` business agent and the `agent_builder` configuration agent, with threads, checkpoints, context summarization, model retries, and tool retries.
- **Knowledge-base RAG**: upload documents, attach knowledge bases to agents, run vector retrieval, and import default assets. Vector data is stored in LanceDB.
- **Skills**: maintain reusable system-prompt skills and let agents read them through the `read_skill` tool.
- **Structured forms**: define forms, records, and access rules so agents can query and maintain business data.
- **MCP configuration**: configure user-scoped MCP servers and attach them dynamically to agent tools.
- **Voice interaction**: supports DashScope ASR/TTS proxying, KWS wake-word detection, VAD, interruption, voice telemetry, and speaker verification.
- **Configuration bundles**: import and export agents, skills, knowledge bases, MCP servers, and form configuration.
- **Accounts and API keys**: includes registration, login, user profile management, user API keys, and external LangGraph SDK access.
- **Web and desktop surfaces**: the same Next.js UI powers the website and the Tauri desktop app.

## Tech Stack

- **Backend**: Python 3.11+, LangGraph, LangChain, Aegra, FastAPI, SQLAlchemy, PostgreSQL, Redis, LanceDB
- **Frontend**: Next.js, React, TypeScript, Tailwind CSS, Radix UI, Bun
- **Voice**: DashScope Realtime API, sherpa-onnx, Ten VAD, SpeechBrain ECAPA speaker verification service
- **Observability**: Langfuse tracing and selected LangSmith sharing helpers
- **Deployment**: Docker Compose with PostgreSQL, Redis, backend, frontend, and speaker services

## Repository Layout

```text
.
├── src/
│   ├── agent/              # LangGraph agent graphs and model configuration
│   ├── api/                # FastAPI routes, auth, voice proxy, and services
│   ├── middleware/         # Dynamic configuration, model retry, and tool retry middleware
│   ├── prompts/            # Agent prompts
│   ├── tools/              # RAG, fetch, skills, forms, MCP, and related tools
│   └── utils/              # Database, asset import, tracing, and runtime helpers
├── frontend/
│   ├── app/                # Next.js routes
│   ├── components/         # Chat, management, marketing, and shared UI components
│   ├── lib/                # API clients, hooks, types, and configuration
│   ├── public/             # Static assets, fonts, and voice worklets
│   └── src-tauri/          # Tauri desktop shell
├── services/speaker/       # Speaker verification service
├── assets/                 # Default business document assets
├── models/                 # Local voice, wake-word, and speaker models
├── tests/                  # Unit and evaluation tests
├── docs/                   # Design, import/export, versioning, and SDK docs
├── langgraph.json          # LangGraph/Aegra configuration
├── aegra.json              # Aegra local/deployment configuration
└── docker-compose.yml      # Local infrastructure and full-stack deployment
```

## Requirements

- Python 3.11+
- [uv](https://github.com/astral-sh/uv)
- [Bun](https://bun.sh/)
- Docker / Docker Compose
- An OpenAI-compatible model service and API key
- DashScope API key for voice features

## Quick Start

### 1. Install Dependencies

```bash
make install
```

Equivalent commands:

```bash
uv sync
cd frontend && bun install
```

### 2. Configure Environment Variables

```bash
cp .env.minimal .env
cp frontend/.env.example frontend/.env.local
```

At minimum, configure the model service in `.env`:

```env
OPENAI_COMPATIBLE_BASE_URL=https://api.openai.com/v1
OPENAI_COMPATIBLE_API_KEY=sk-your_api_key_here
OPENAI_COMPATIBLE_DEFAULT_MODEL=gpt-4o
```

This minimal setup uses the default CORS policy, local SQLite fallback, and an OpenAI-compatible model service. It is enough to start accounts, the management UI, agent chat, skills, forms, MCP configuration, and model proxying.

For production, also set:

```env
SESSION_JWT_SECRET=change_me_to_a_random_session_secret
SESSION_COOKIE_SECURE=true
# Use SESSION_COOKIE_SAMESITE=none for cross-site frontend/backend deployments.
CORS_ALLOW_ORIGINS=https://your-frontend.example.com
```

The frontend defaults to:

```env
NEXT_PUBLIC_LANGGRAPH_API_URL=http://localhost:2025
NEXT_PUBLIC_OPENAI_DEFAULT_MODEL=gpt-4o
```

For the full configuration template:

```bash
cp .env.example .env
```

Optional modules in `.env.example` are commented out by default. Enable only what you need.

### 3. Start Local Development

Start PostgreSQL, Redis, the speaker service, backend, and frontend together:

```bash
make dev-local
```

Default local URLs:

- Web UI: <http://localhost:3000>
- Backend API: <http://localhost:2025>
- API docs: <http://localhost:2025/docs>
- LangGraph Studio: <https://smith.langchain.com/studio/?baseUrl=http://127.0.0.1:2025>

You can also start services separately:

```bash
make dev-backend
make dev-frontend
```

## Common Commands

```bash
# Install backend and frontend dependencies
make install

# Start the full local development environment
make dev-local

# Start only the backend
make dev-backend

# Start only the frontend
make dev-frontend

# Build the website frontend
cd frontend && bun run build

# Build the static export used by Tauri
cd frontend && bun run build:desktop

# Build the desktop app for the current platform
cd frontend && bun run tauri:build

# Run backend tests
uv run pytest

# Run Python lint
uv run ruff check src tests

# Import or refresh default knowledge-base assets
make update-assets

# Deploy the full Docker Compose stack
make deploy-all

# View full-stack logs
make deploy-all-logs
```

## API Overview

The FastAPI app is mounted inside the Aegra/LangGraph HTTP service. Key endpoints include:

- `/health`: health check
- `/api/auth/*`: registration, login, user profile, and API keys
- `/api/agent-profiles`: agent profile CRUD, version restore, and share import
- `/api/knowledge-bases`: knowledge-base management, document upload, and RAG status
- `/api/skills`: skill management
- `/api/forms`: form and form-record management
- `/api/mcp-servers`: MCP server configuration
- `/api/models`: OpenAI-compatible model list proxy
- `/api/capabilities`: backend capability metadata used by the frontend
- `/api/config-bundles/*`: configuration bundle import/export
- `/ws/voice/*`: ASR/TTS voice WebSockets
- `/langsmith/*`: LangSmith run lookup and sharing helpers

Interactive API docs are available at `/docs`; the OpenAPI schema is available at `/openapi.json`.

## Runtime Configuration

The backend exposes available modules through `/api/capabilities`. Each module reports whether it is enabled, its category, required environment variables, optional environment variables, and defaults.

Core modules:

| Module | Purpose | Required env | Notes |
| --- | --- | --- | --- |
| `core.model` | Agent execution, model calls, and context summaries | `OPENAI_COMPATIBLE_API_KEY` | `OPENAI_COMPATIBLE_BASE_URL` can be omitted for the OpenAI default endpoint; `OPENAI_COMPATIBLE_DEFAULT_MODEL=gpt-4o` |
| `core.database` | Users, workspaces, agent profiles, forms, skills, and MCP metadata | None | Uses `./chat_langchain.db` SQLite fallback when PostgreSQL is not configured |
| `core.cors` | Allows frontend access to the backend | None | Defaults to local development origins; configure `CORS_ALLOW_ORIGINS` in production |
| `auth.password` | Password login, registration, user profiles, and API keys | None | Browser sessions use HttpOnly cookies; set `SESSION_JWT_SECRET` in production |

Optional modules:

| Module | Enabled by | Main env vars | Defaults |
| --- | --- | --- | --- |
| `models.proxy` | OpenAI-compatible base URL and API key | `OPENAI_COMPATIBLE_BASE_URL`, `OPENAI_COMPATIBLE_API_KEY` | `MODEL_LIST_CACHE_TTL_SECONDS=300` |
| `knowledge.rag` | Model API key | `OPENAI_COMPATIBLE_API_KEY` | `OPENAI_EMBEDDING_MODEL=text-embedding-v3`, `LANCEDB_PATH=/tmp/lancedb_agents`, `KNOWLEDGE_DOCUMENTS_PATH=/tmp/tobagent_knowledge_documents` |
| `agent.skills` | Enabled by default | Database configuration | Skills are managed in the UI |
| `agent.forms` | Enabled by default | Database configuration | Forms and permissions are managed in the UI |
| `agent.mcp` | Enabled by default | Database configuration | Users configure streamable HTTP MCP servers |
| `agent.subagents` | Enabled by default | Database configuration | Profiles can link child agents |
| `auth.sms` | Aliyun SMS credentials or dev log mode | `ALIYUN_SMS_TEMPLATE_CODE`, `ALIYUN_ACCESS_KEY_ID`, `ALIYUN_ACCESS_KEY_SECRET`, `ALIYUN_SMS_SIGN_NAME` | `SMS_CODE_TTL_SECONDS=300`, `SMS_RESEND_INTERVAL_SECONDS=60`; local dev can use `SMS_DEV_LOG_CODE=true` |
| `observability.langfuse` | Langfuse public and secret keys | `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | `LANGFUSE_BASE_URL=https://cloud.langfuse.com` |
| `voice.asr` | DashScope API key | `DASHSCOPE_API_KEY` | `ASR_MODEL=qwen3-asr-flash`, VAD threshold `0.5` |
| `voice.tts` | DashScope API key | `DASHSCOPE_API_KEY` | `TTS_MODEL=qwen3-tts-instruct-flash-realtime`, `TTS_VOICE=Cherry` |
| `voice.wakeWord` | Local KWS model directory | `KWS_MODEL_DIR` | `KWS_MODEL_DIR=./models/kws`, `KWS_NUM_THREADS=2` |
| `voice.speakerVerification` | Explicit speaker verification enablement | `VOICE_SPEAKER_VERIFICATION_ENABLED=true` | `SPEAKER_SERVICE_URL=http://speaker:8090`, `VOICE_SPEAKER_PROFILE_THRESHOLD=0.72` |

System-level modules are controlled by environment variables and exposed through `/api/capabilities`. Agent runtime modules are controlled by the agent profile stored in the database, including tools, knowledge bases, skills, forms, MCP servers, subagents, model, and temperature.

## Agent Runtime

`generic_agent` is the main business agent. The frontend passes the active agent profile as LangGraph runtime context, including:

- `system_prompt`
- `model`
- `enabled_tools`
- `agent_id`
- `user_id`
- `knowledge_base_ids`
- `skill_ids`
- `mcp_ids`
- `form_ids`
- voice-related settings

The backend injects those values through `dynamic_config_middleware` and scopes resource access by agent and user. Built-in tools include:

- `rag_search`
- `fetch`
- `read_skill`
- `query_form_data`
- `manage_form_data`

## Voice And Android WebView

The web frontend supports both browser voice mode and an Android WebView native bridge. The Android project is expected at:

```text
/mnt/c/Users/wrsi/Documents/wsrtobandroid
```

When changing voice, wake-word, ASR/VAD, TTS playback, interruption, speaker verification, WebView bridge, telemetry, or agent-profile voice semantics, inspect the Android side as well. Keep `TobNativeVoice` / `__TOB_NATIVE_VOICE__` and frontend `nativeVoiceEvent` handling aligned for states such as `idle`, `kws`, `listening`, `transcribing`, `processing`, and `speaking`.

## Testing

Backend:

```bash
uv run pytest
uv run pytest tests/unit
uv run ruff check src tests
```

Frontend:

```bash
cd frontend && bun run build
cd frontend && bun run build:desktop
```

Run the checks that match the scope of your change before submitting. For UI changes, run the frontend production build.

## Deployment

The full Docker Compose stack includes:

- `postgres`: PostgreSQL + pgvector
- `redis`: LangGraph/runtime broker
- `tobagent`: backend Aegra/FastAPI/LangGraph service
- `speaker`: speaker verification service
- `frontend`: Next.js frontend

Start the full stack:

```bash
make deploy-all
```

View logs:

```bash
make deploy-all-logs
```

Stop services:

```bash
docker compose down
```

## Related Documentation

- [Design guidelines](docs/design.md)
- [Configuration import/export](docs/config-import-export.md)
- [Versioning](docs/versioning.md)
- [LangGraph SDK external calls](docs/langgraph-sdk-custom-agent.md)

## License

This repository is based on an upstream MIT-licensed project. The original MIT license text and copyright notice are preserved in [LICENSE](LICENSE).

Project-specific additions and modifications are described as being provided under the Elastic License 2.0. See [LICENSE-ELASTIC-2.0](LICENSE-ELASTIC-2.0) for the ELv2 terms. This section is only a summary for repository readers; review the license files for the complete terms.
