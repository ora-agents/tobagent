# Repository Guidelines

## Project Structure & Module Organization

This repository contains a LangGraph documentation agent with a Next.js frontend and a Tauri desktop shell. Backend code lives in `src/`: `src/agent/` defines graph and agent configuration, `src/api/` exposes FastAPI/LangGraph endpoints, `src/tools/` contains agent tools, `src/middleware/` holds runtime middleware, and `src/prompts/` stores prompts. Tests are under `tests/unit/` and `tests/evals/`. Domain documents and local model artifacts live in `assets/` and `models/`.

Frontend code lives in `frontend/`. The website uses Next.js routes in `frontend/app/`, React components in `frontend/components/`, client logic in `frontend/lib/`, and browser assets in `frontend/public/`. The desktop application uses the same Next.js UI as a static export, with the Tauri shell in `frontend/src-tauri/`.

安卓软件地址：`C:\Users\wrsi\Documents\wsrtobandroid`，WSL 路径为 `/mnt/c/Users/wrsi/Documents/wsrtobandroid`。

## Cross-Project Android Coordination

When changing voice, wake-word, ASR/VAD, TTS playback, interruption, speaker verification, WebView bridge, telemetry, or agent-profile configuration behavior, also inspect the Android project at `/mnt/c/Users/wrsi/Documents/wsrtobandroid`. The Android app owns the native voice provider exposed through `TobNativeVoice` / `__TOB_NATIVE_VOICE__` and sends `nativeVoiceEvent` payloads consumed by `frontend/lib/hooks/files/use-voice-agent.ts`.

Keep web and Android behavior aligned for shared state-machine semantics such as `idle`, `kws`, `listening`, `transcribing`, `processing`, `speaking`, `speech_start`, `asr`, `speaker_rejected`, `tts_audio`, and `tts_done`. If a frontend change adds, removes, or reinterprets a native bridge field, update or explicitly verify the Android counterpart in the same task. In particular, changes to `voiceInterruptionEnabled` must be checked on both sides so disabled interruption suppresses speech captured during an agent reply and does not send delayed ASR text after playback ends.

Do not assume Windows paths are inaccessible from WSL. Use the `/mnt/c/...` path above for reads, searches, and edits when the task touches these integration points. Keep Android commits separate from this repository unless the user explicitly asks for a coordinated multi-repo commit.

## Frontend Website vs Desktop App

The frontend has two deployable surfaces:

- Website: the browser-hosted Next.js app. The main management UI is the root route `/`, and `agentapp` is the separate app under `/agentapp`. Web changes usually affect `frontend/app/**`, `frontend/components/**`, `frontend/lib/**`, and `frontend/public/**`.
- Desktop app: the Tauri application under `frontend/src-tauri/`. It packages the static Next.js export from `frontend/out` and does not automatically start an embedded local backend. Desktop builds default to the official backend `https://gen.wsiri.cn`, and future backend-switching UI must be limited to the Tauri runtime unless explicitly requested for the website.

When changing frontend behavior, state whether the change affects the website, the desktop app, or both. For website-only changes, do not modify Tauri config or desktop release workflows. For desktop-only changes, verify `frontend/src-tauri`, `frontend/package.json` desktop scripts, and `frontend/lib/constants/api.ts` when backend routing is involved.

## Build, Test, and Development Commands

- `make install` installs backend dependencies with `uv` and frontend dependencies with Bun.
- `make dev-backend` starts the LangGraph server on `0.0.0.0`.
- `make dev-frontend` starts the Next.js UI against the configured remote API.
- `make dev-local` runs backend and frontend together for local integration.
- `cd frontend && bun run build` verifies the website production build.
- `cd frontend && bun run build:desktop` verifies the static export used by Tauri.
- `cd frontend && bun run tauri:build` builds the desktop app for the current platform.
- `uv run pytest` runs all Python tests; use `uv run pytest tests/unit` for unit tests.
- `uv run ruff check src tests` lints Python code.
- `cd frontend && bun install` installs frontend dependencies; keep `frontend/bun.lock` authoritative.

## Coding Style & Naming Conventions

Python targets 3.11+ and is linted with Ruff using `E`, `F`, `I`, `D`, `D401`, `T201`, and `UP` rules. Use 4-space indentation, Google-style docstrings where useful, and snake_case for modules, functions, and variables. Keep tests named `test_*.py`. Frontend code uses TypeScript, React, Next.js app routing, Tailwind CSS, and Radix UI. Use kebab-case for component filenames, PascalCase for exported React components, and keep shared utilities in `frontend/lib/`.

## Frontend UI Design

When making UI or styling changes, prefer the visual system in `docs/design.md` as the primary reference for colors, typography, spacing, layout, elevation, border radius, and component treatments. Keep new frontend work consistent with those tokens and patterns unless the task explicitly calls for a different style.

Prefer minimal, reusable component composition for frontend UI work. Before creating page-specific markup, check whether an existing shared component or shadcn/ui component can be composed or lightly customized. Build new shared components only when they capture a real repeated pattern, keep their props small and stable, and place them where they can be reused across the website and desktop surfaces without coupling them to one route.

Use shadcn/ui as the default base for common controls, overlays, forms, feedback states, navigation, cards, tables, and empty/loading states. Customize through semantic design tokens, variants, and composition instead of raw Tailwind color overrides or one-off styled wrappers. When adding or changing shadcn components, follow the project component registry conventions and keep generated component code reviewable.

Design all new UI for light and dark themes from the start. Use semantic tokens such as `background`, `foreground`, `muted`, `border`, `primary`, and component variants so dark mode works without manual per-element color fixes. Verify hover, focus, disabled, selected, error, empty, and loading states have sufficient contrast in both themes.

## Testing Guidelines

Add focused unit tests in `tests/unit/` for isolated utilities, middleware, and API helpers. Use `tests/evals/` for agent behavior, guardrail, retry, and tool-wiring checks. Prefer deterministic tests that avoid live network calls unless the behavior explicitly requires integration coverage. Run `uv run pytest` before submitting backend changes and `cd frontend && bun run build` before submitting UI changes.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commits with scopes, such as `feat(frontend): add wake words editor` and `fix(frontend): debounce speaking-to-listening transition`. Follow `feat|fix|refactor|test|docs(scope): short imperative summary`. When completing a feature or task, make a separate commit containing only the related files for that specific unit of work. Pull requests should describe the user-visible change, list backend/frontend impacts, mention required environment variables, link issues when available, and include screenshots or recordings for UI changes.

Desktop app releases are built by `.github/workflows/desktop-release.yml` from tags like `v0.1.0`. That workflow builds Linux, Windows, and macOS artifacts with `tauri-apps/tauri-action`; keep release workflow changes separate from website deployment changes unless the task explicitly spans both.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local backend configuration and keep secrets out of git. Frontend-local secrets belong in `frontend/.env.local`. Do not commit generated caches such as `.pytest_cache/`, `.langgraph_api/`, or local virtual environments.
