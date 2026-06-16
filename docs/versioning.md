# Versioning

This repository uses independent service versions. Do not treat the backend,
frontend, speaker, and frontend local-storage config version as one shared
number.

## Version Sources

- Backend service version: `backend-vX.Y.Z` tags
- Frontend service version: `frontend-vX.Y.Z` tags
- Speaker service version: `speaker-vX.Y.Z` tags
- Backend package metadata: `pyproject.toml`
- Frontend package metadata: `frontend/package.json`
- Frontend saved-config version: `CONFIG_STORAGE.version` in
  `frontend/lib/config/deployment-config.ts`

`CONFIG_STORAGE.version` is only used to reset saved browser config. Bump it
only when old localStorage data should be discarded.

## Conventional Commits

Pushes to `main` or `master` create service-scoped release tags automatically
when service files changed. The workflow checks the commits since the latest
tag for each changed service and applies this SemVer mapping:

- `fix(scope): ...` and other non-feature service changes bump `PATCH`.
- `feat(scope): ...` bumps `MINOR`.
- `type(scope)!: ...` or a `BREAKING CHANGE:` footer bumps `MAJOR`.

The workflow filters commits by the files they changed, not only by scope. A
`feat(backend): ...` commit does not bump frontend unless it also changed
`frontend/**`.

## Service Tags

The workflow uses service-scoped Git tags for releases:

- `backend-vX.Y.Z`
- `frontend-vX.Y.Z`
- `speaker-vX.Y.Z`

Normal branch pushes create these tags automatically. Manual service tags are
still supported:

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

Branch deploy images are tagged with the commit SHA and `main`. If the push
created a service release tag, the corresponding image is also tagged with that
service version.

## Bump Checklist

For a frontend bug fix:

```bash
git add frontend
git commit -m "fix(frontend): ..."
git push origin main
```

For a backend feature:

```bash
git add src pyproject.toml uv.lock
git commit -m "feat(backend): ..."
git push origin main
```

For a breaking speaker change:

```bash
git add services/speaker
git commit -m "feat(speaker)!: ..."
git push origin main
```
