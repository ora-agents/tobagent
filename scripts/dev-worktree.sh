#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT_DIR"

BACKEND_HOST=${BACKEND_HOST:-0.0.0.0}
BACKEND_PORT_START=${BACKEND_PORT_START:-2025}
FRONTEND_HOST=${FRONTEND_HOST:-0.0.0.0}
FRONTEND_PORT_START=${FRONTEND_PORT_START:-3000}
POSTGRES_CONTAINER=${POSTGRES_CONTAINER:-tobagent-postgres}
REDIS_CONTAINER=${REDIS_CONTAINER:-tobagent-redis}
SPEAKER_CONTAINER=${SPEAKER_CONTAINER:-tobagent-speaker}

if command -v python3 >/dev/null 2>&1; then
  PYTHON=python3
elif command -v python >/dev/null 2>&1; then
  PYTHON=python
else
  echo "Python is required to select free ports and prepare the worktree config." >&2
  exit 1
fi

require_healthy_container() {
  local container=$1
  local running health

  running=$(docker inspect --format '{{.State.Running}}' "$container" 2>/dev/null || true)
  if [[ "$running" != "true" ]]; then
    echo "Shared infra container '$container' is not running." >&2
    echo "Start infra from the primary worktree first: make dev-infra" >&2
    exit 1
  fi

  health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$container")
  if [[ "$health" != "none" && "$health" != "healthy" ]]; then
    echo "Shared infra container '$container' is $health; wait for it to become healthy." >&2
    exit 1
  fi
}

container_host_port() {
  local container=$1
  local container_port=$2
  local mapping

  mapping=$(docker port "$container" "$container_port/tcp" 2>/dev/null | head -n 1)
  if [[ -z "$mapping" ]]; then
    echo "Container '$container' does not publish TCP port $container_port." >&2
    exit 1
  fi
  printf '%s\n' "${mapping##*:}"
}

container_env() {
  local container=$1
  local name=$2

  docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$container" \
    | sed -n "s/^${name}=//p" \
    | head -n 1
}

find_free_port() {
  local start=$1
  local excluded=${2:-0}

  "$PYTHON" - "$start" "$excluded" <<'PY'
import socket
import sys

port = int(sys.argv[1])
excluded = int(sys.argv[2])
while port <= 65535:
    if port == excluded:
        port += 1
        continue
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 0)
            sock.bind(("", port))
    except OSError:
        port += 1
        continue
    print(port)
    break
else:
    raise SystemExit(f"No free TCP port found at or above {sys.argv[1]}")
PY
}

for container in "$POSTGRES_CONTAINER" "$REDIS_CONTAINER" "$SPEAKER_CONTAINER"; do
  require_healthy_container "$container"
done

POSTGRES_PORT=$(container_host_port "$POSTGRES_CONTAINER" 5432)
REDIS_PORT=$(container_host_port "$REDIS_CONTAINER" 6379)
SPEAKER_PORT=$(container_host_port "$SPEAKER_CONTAINER" 8090)

POSTGRES_USER=$(container_env "$POSTGRES_CONTAINER" POSTGRES_USER)
POSTGRES_PASSWORD=$(container_env "$POSTGRES_CONTAINER" POSTGRES_PASSWORD)
POSTGRES_DB=$(container_env "$POSTGRES_CONTAINER" POSTGRES_DB)

if [[ -z "$POSTGRES_USER" || -z "$POSTGRES_PASSWORD" || -z "$POSTGRES_DB" ]]; then
  echo "Could not read PostgreSQL connection settings from '$POSTGRES_CONTAINER'." >&2
  exit 1
fi

BACKEND_PORT=$(find_free_port "$BACKEND_PORT_START")
FRONTEND_PORT=$(find_free_port "$FRONTEND_PORT_START" "$BACKEND_PORT")
BACKEND_URL="http://127.0.0.1:$BACKEND_PORT"
FRONTEND_URL="http://127.0.0.1:$FRONTEND_PORT"

WORKTREE_CONFIG=$(mktemp "$ROOT_DIR/.aegra-worktree.XXXXXX.json")
export WORKTREE_CONFIG FRONTEND_PORT
"$PYTHON" <<'PY'
import json
import os
from pathlib import Path

source = Path("aegra.json")
target = Path(os.environ["WORKTREE_CONFIG"])
config = json.loads(source.read_text(encoding="utf-8"))
cors = config.setdefault("http", {}).setdefault("cors", {})
origins = cors.setdefault("allow_origins", [])
port = os.environ["FRONTEND_PORT"]
for origin in (f"http://localhost:{port}", f"http://127.0.0.1:{port}"):
    if origin not in origins:
        origins.append(origin)
target.write_text(json.dumps(config, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
PY

pids=""
cleanup() {
  trap - INT TERM EXIT
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
    wait $pids 2>/dev/null || true
  fi
  rm -f "$WORKTREE_CONFIG"
}
trap cleanup INT TERM EXIT

if [[ -x ./.venv/Scripts/aegra.exe ]]; then
  aegra=(./.venv/Scripts/aegra.exe)
elif [[ -x ./.venv/bin/aegra ]]; then
  aegra=(./.venv/bin/aegra)
else
  aegra=(uv run aegra)
fi

echo "Reusing shared infra:"
echo "  PostgreSQL  127.0.0.1:$POSTGRES_PORT ($POSTGRES_CONTAINER)"
echo "  Redis       127.0.0.1:$REDIS_PORT ($REDIS_CONTAINER)"
echo "  Speaker     127.0.0.1:$SPEAKER_PORT ($SPEAKER_CONTAINER)"
echo "Starting worktree services:"
echo "  Backend     $BACKEND_URL"
echo "  Frontend    $FRONTEND_URL"

DATABASE_URL= \
POSTGRES_HOST=127.0.0.1 \
POSTGRES_PORT="$POSTGRES_PORT" \
POSTGRES_USER="$POSTGRES_USER" \
POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
POSTGRES_DB="$POSTGRES_DB" \
REDIS_BROKER_ENABLED=true \
REDIS_URL="redis://127.0.0.1:$REDIS_PORT/0" \
SPEAKER_SERVICE_URL="http://127.0.0.1:$SPEAKER_PORT" \
"${aegra[@]}" dev --no-db-check -c "$WORKTREE_CONFIG" --host "$BACKEND_HOST" --port "$BACKEND_PORT" &
pids="$pids $!"

(
  cd frontend
  NEXT_PUBLIC_LANGGRAPH_API_URL="$BACKEND_URL" \
    bun run dev -- -H "$FRONTEND_HOST" -p "$FRONTEND_PORT"
) &
pids="$pids $!"

wait $pids
