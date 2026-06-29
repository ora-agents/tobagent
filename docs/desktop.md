# Desktop Packaging

This project can be packaged as a local desktop app with:

- Tauri for the desktop shell.
- A static Next.js export for the UI.
- A Nuitka standalone binary for the local FastAPI backend.

## Build Flow

```bash
make desktop
```

The target runs:

1. `make desktop-backend` to build `desktop/backend_entry.py` with Nuitka.
2. `make desktop-frontend` to export the Next.js UI to `frontend/out`.
3. `make desktop-tauri` to build the Tauri desktop bundle.

For a faster frontend-only check:

```bash
cd frontend && bun run build:desktop
```

## Local Backend Runtime

The Tauri app starts the bundled backend binary from `bin/tobagent-backend` or
`bin/tobagent-backend.exe` on `127.0.0.1:2025`.

`scripts/build_desktop_backend.py` includes `assets/` and `models/` only when
those directories exist. This keeps CI builds working when local model files are
not checked into the repository.

The desktop backend entrypoint sets local defaults before importing the app:

- `DATABASE_URL` points to a SQLite file in the user's app data directory.
- `LANCEDB_PATH` points to the user's app data directory.
- `KWS_MODEL_DIR` uses bundled `models/kws` when available.
- `VOICE_TEN_VAD_MODEL_PATH` uses bundled `models/vad/ten-vad.onnx`.
- `TOB_ASSETS_DIR` points to bundled `assets` when available.

For Tauri development with an externally started backend:

```bash
TOB_DESKTOP_BACKEND_EXTERNAL=1 cd frontend && bun run tauri:dev
```

Or point Tauri at a manually built backend binary:

```bash
TOB_DESKTOP_BACKEND_BIN=/path/to/tobagent-backend cd frontend && bun run tauri:dev
```

## Platform Notes

Linux Nuitka standalone builds require `patchelf`:

```bash
sudo apt install patchelf
```

Windows desktop builds should be run on Windows so Tauri produces a Windows
installer and Nuitka emits `tobagent-backend.exe`.

## GitHub Actions

The `Build desktop app` workflow builds the Windows desktop bundle on
`windows-latest` and uploads `frontend/src-tauri/target/release/bundle/**` as an
artifact. Run it manually from GitHub Actions, or push a `desktop-v*` tag.
