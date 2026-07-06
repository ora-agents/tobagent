# Desktop Packaging

This project can be packaged as a local desktop app with:

- Tauri for the desktop shell.
- A static Next.js export for the UI.
- A configurable remote or user-managed FastAPI backend.
- An optional PyQt local backend manager for individual users.

## Build Flow

```bash
make desktop
```

The target runs:

1. `make desktop-frontend` to export the Next.js UI to `frontend/out`.
2. `make desktop-tauri` to build the Tauri desktop bundle.

On Linux/WSL the default Tauri bundle targets are `.deb` and `.rpm`. AppImage
packaging is intentionally skipped until the project has square icon assets.

For a faster frontend-only check:

```bash
cd frontend && bun run build:desktop
```

## Backend Runtime

The Tauri app does not start a bundled backend process automatically. The UI
connects to the configured backend URL, so users can use the official service or
a backend they run themselves.

Run the PyQt local backend manager with:

```bash
make local-backend-manager
```

`make desktop-backend` is kept as an alias for the same manager. The manager
edits the repository `.env`, starts and stops the local backend process, displays
logs, and checks `http://127.0.0.1:2026/health` by default. It launches
`desktop/backend_entry.py`, which starts the full Aegra server
(`aegra_api.main:app`) instead of only the custom FastAPI routes. The entrypoint
installs a desktop-local Aegra database manager before importing Aegra, so the
Agent Protocol routes such as `/threads`, `/runs`, `/assistants`, and `/store`
use local SQLite files.

The backend entrypoint sets local defaults before importing the app:

- `AEGRA_CONFIG` points to the bundled or source `langgraph.json`.
- Aegra startup migrations are disabled because the local runtime creates its
  own SQLite metadata tables.
- Aegra run streaming uses the in-process broker rather than Redis.
- Aegra metadata, checkpoints, and store data are persisted in SQLite files in
  the user's app data directory.
- `DATABASE_URL` points to a SQLite file in the user's app data directory for
  the repository's custom FastAPI routes.
- `LANCEDB_PATH` points to the user's app data directory.
- `KWS_MODEL_DIR` uses bundled `models/kws` when available.
- `VOICE_TEN_VAD_MODEL_PATH` uses bundled `models/vad/ten-vad.onnx`.
- `TOB_ASSETS_DIR` points to bundled `assets` when available.

## Platform Notes

Install the PyQt manager dependencies with:

```bash
uv sync --group local-backend
```

Windows desktop builds should be run on Windows so Tauri produces a Windows
installer. The local backend manager is a Python/PyQt application and is not
bundled into the Tauri installer by default.

## GitHub Actions

The `Build desktop app` workflow builds the Windows desktop bundle on
`windows-latest` and uploads `frontend/src-tauri/target/release/bundle/**` as an
artifact. Run it manually from GitHub Actions, or push a `desktop-v*` tag.
