# Versioning

This repository uses independent service versions. Do not treat the backend,
frontend, speaker, and frontend local-storage config version as one shared
number.

## Version Sources

- Backend package version: `pyproject.toml`
- Frontend package version: `frontend/package.json`
- Speaker service version: release tag only
- Frontend saved-config version: `CONFIG_STORAGE.version` in
  `frontend/lib/config/deployment-config.ts`

`CONFIG_STORAGE.version` is only used to reset saved browser config. Bump it
only when old localStorage data should be discarded.

## Service Tags

Use service-scoped Git tags for releases:

- `backend-vX.Y.Z`
- `frontend-vX.Y.Z`
- `speaker-vX.Y.Z`

Examples:

```bash
git tag frontend-v0.1.1
git push origin frontend-v0.1.1
```

Pushing a service tag builds and deploys only that service image. The image is
tagged with both the service version and the commit SHA, for example:

```text
ghcr.io/<owner>/<repo>/frontend:v0.1.1
ghcr.io/<owner>/<repo>/frontend:<commit-sha>
```

## Branch Deploys

Pushes to `main` or `master` still use path-based builds:

- Frontend changes under `frontend/**` build only the frontend image.
- Backend changes under `src/**`, `Dockerfile`, `pyproject.toml`, `uv.lock`,
  `aegra.json`, `langgraph.json`, or `assets/**` build only the backend image.
- Speaker changes under `services/speaker/**` build only the speaker image.
- `docker-compose.yml` changes redeploy using the currently running images.

Branch deploy images are tagged with the commit SHA and `main`.

## Bump Checklist

For a frontend bug fix:

```bash
vim frontend/package.json
git add frontend/package.json
git commit -m "fix(frontend): ..."
git tag frontend-v0.1.1
git push origin main frontend-v0.1.1
```

For a backend bug fix:

1. Update `version` in `pyproject.toml`.
2. Commit the backend change and version bump together.
3. Tag the commit as `backend-vX.Y.Z`.
4. Push `main` and the tag.

For speaker changes, tag the release as `speaker-vX.Y.Z`.
