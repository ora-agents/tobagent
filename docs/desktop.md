# Desktop Packaging

This project can be packaged as a local desktop app with:

- Tauri for the desktop shell.
- A static Next.js export for the UI.
- A configurable remote or user-managed backend.

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

The Tauri app does not start or bundle a backend process. The UI connects to the
configured backend URL, so users can use the official service or a backend they
run themselves. Desktop builds default to `https://gen.wsiri.cn`.

## Platform Notes

Windows desktop builds should be run on Windows so Tauri produces a Windows
installer.

## GitHub Actions

The `Build desktop app` workflow builds the Windows desktop bundle on
`windows-latest` and uploads `frontend/src-tauri/target/release/bundle/**` as an
artifact. Run it manually from GitHub Actions, or push a `desktop-v*` tag.
