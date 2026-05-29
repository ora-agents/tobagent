# Repository Guidelines

## Project Structure & Module Organization

This repository contains a LangGraph documentation agent with a Next.js chat UI. Backend code lives in `src/`: `src/agent/` defines graph and agent configuration, `src/api/` exposes FastAPI/LangGraph endpoints, `src/tools/` contains agent tools, `src/middleware/` holds runtime middleware, and `src/prompts/` stores prompts. Tests are under `tests/unit/` and `tests/evals/`. The frontend is in `frontend/`, with routes in `frontend/app/`, React components in `frontend/components/`, client logic in `frontend/lib/`, and browser assets in `frontend/public/`. Domain documents and local model artifacts live in `assets/` and `models/`.

## Build, Test, and Development Commands

- `make install` installs backend dependencies with `uv` and frontend dependencies with Bun.
- `make dev-backend` starts the LangGraph server on `0.0.0.0`.
- `make dev-frontend` starts the Next.js UI against the configured remote API.
- `make dev-local` runs backend and frontend together for local integration.
- `uv run pytest` runs all Python tests; use `uv run pytest tests/unit` for unit tests.
- `uv run ruff check src tests` lints Python code.
- `cd frontend && bun install` installs frontend dependencies; keep `frontend/bun.lock` authoritative.
- `cd frontend && bun run build` verifies production build.

## Coding Style & Naming Conventions

Python targets 3.11+ and is linted with Ruff using `E`, `F`, `I`, `D`, `D401`, `T201`, and `UP` rules. Use 4-space indentation, Google-style docstrings where useful, and snake_case for modules, functions, and variables. Keep tests named `test_*.py`. Frontend code uses TypeScript, React, Next.js app routing, Tailwind CSS, and Radix UI. Use kebab-case for component filenames, PascalCase for exported React components, and keep shared utilities in `frontend/lib/`.

## Frontend UI Design

When making UI or styling changes, prefer the visual system in `docs/design.md` as the primary reference for colors, typography, spacing, layout, elevation, border radius, and component treatments. Keep new frontend work consistent with those tokens and patterns unless the task explicitly calls for a different style.

## Testing Guidelines

Add focused unit tests in `tests/unit/` for isolated utilities, middleware, and API helpers. Use `tests/evals/` for agent behavior, guardrail, retry, and tool-wiring checks. Prefer deterministic tests that avoid live network calls unless the behavior explicitly requires integration coverage. Run `uv run pytest` before submitting backend changes and `cd frontend && bun run build` before submitting UI changes.

## Commit & Pull Request Guidelines

Recent history uses Conventional Commits with scopes, such as `feat(frontend): add wake words editor` and `fix(frontend): debounce speaking-to-listening transition`. Follow `feat|fix|refactor|test|docs(scope): short imperative summary`. When completing a feature or task, make a separate commit containing only the related files for that specific unit of work. Pull requests should describe the user-visible change, list backend/frontend impacts, mention required environment variables, link issues when available, and include screenshots or recordings for UI changes.

## Security & Configuration Tips

Copy `.env.example` to `.env` for local backend configuration and keep secrets out of git. Frontend-local secrets belong in `frontend/.env.local`. Do not commit generated caches such as `.pytest_cache/`, `.langgraph_api/`, or local virtual environments.
