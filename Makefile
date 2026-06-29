.PHONY: \
	dev dev-frontend dev-backend dev-local dev-infra \
	prod prod-backend prod-frontend build-frontend start-frontend \
	deploy-prod deploy-prod-no-build deploy-down deploy-logs \
	check-backend-port check-frontend-port check-ports \
	stop-backend-port stop-frontend-port stop-ports \
	install install-frontend install-backend \
	desktop desktop-backend desktop-frontend desktop-tauri \
	update-assets refresh-assets \
	lint-actions \
	test-agent-sdk

# Add standard Node.js and Bun paths to PATH for Windows/Git Bash users
export PATH := $(PATH):/c/Program Files/nodejs:$(HOME)/.bun/bin

BACKEND_HOST ?= 0.0.0.0
BACKEND_PORT ?= 2025
FRONTEND_HOST ?= 0.0.0.0
FRONTEND_PORT ?= 3000
SPEAKER_PORT ?= 8090
AEGRA ?= $(shell if [ -x ./.venv/Scripts/aegra.exe ]; then printf './.venv/Scripts/aegra.exe'; elif [ -x ./.venv/bin/aegra ]; then printf './.venv/bin/aegra'; else printf 'uv run aegra'; fi)
SDK_TEST_SCRIPT ?= scripts/langgraph_sdk_external_call.py
SDK_LOG_FILE ?= logs/test-agent-sdk.log
LANGGRAPH_API_URL ?= http://localhost:2025
LANGGRAPH_ASSISTANT_ID ?= generic_agent
TOB_AGENT_ID ?= cfd97b38-0751-4a88-b441-8424db410f81
MESSAGE ?= 你可以调用子智能体吗？

define run_frontend
cd frontend && bun run $(1)
endef

define run_frontend_local
cd frontend && bun run dev -- -H $(FRONTEND_HOST) -p $(FRONTEND_PORT)
endef

define run_concurrent
cleanup() { \
	trap - INT TERM EXIT; \
	if [ -n "$$pids" ]; then \
		kill $$pids 2>/dev/null || true; \
		wait $$pids 2>/dev/null || true; \
	fi; \
}; \
pids=""; \
trap cleanup INT TERM EXIT; \
$(1) & pids="$$pids $$!"; \
$(2) & pids="$$pids $$!"; \
wait $$pids
endef

define check_port
@if command -v ss >/dev/null 2>&1; then \
	if ss -ltn "sport = :$($(1))" | grep -q LISTEN; then \
		echo "$(2) port $($(1)) is already in use. Stop the existing $(3) or run with $(1)=<port>."; \
		exit 1; \
	fi; \
elif command -v lsof >/dev/null 2>&1; then \
	if lsof -nP -iTCP:$($(1)) -sTCP:LISTEN >/dev/null; then \
		echo "$(2) port $($(1)) is already in use. Stop the existing $(3) or run with $(1)=<port>."; \
		exit 1; \
	fi; \
elif command -v powershell.exe >/dev/null 2>&1; then \
	powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '& { $$port = [int]$($(1)); if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { Write-Host "Warning: cannot check whether port $$port is available; install ss or lsof."; exit 0 }; $$conns = @(Get-NetTCPConnection -LocalPort $$port -State Listen -ErrorAction SilentlyContinue); if ($$conns.Count -gt 0) { Write-Host "$(2) port $$port is already in use. Stop the existing $(3) or run with $(1)=<port>."; exit 1 } }'; \
elif command -v powershell >/dev/null 2>&1; then \
	powershell -NoProfile -ExecutionPolicy Bypass -Command '& { $$port = [int]$($(1)); if (-not (Get-Command Get-NetTCPConnection -ErrorAction SilentlyContinue)) { Write-Host "Warning: cannot check whether port $$port is available; install ss or lsof."; exit 0 }; $$conns = @(Get-NetTCPConnection -LocalPort $$port -State Listen -ErrorAction SilentlyContinue); if ($$conns.Count -gt 0) { Write-Host "$(2) port $$port is already in use. Stop the existing $(3) or run with $(1)=<port>."; exit 1 } }'; \
else \
	echo "Warning: cannot check whether port $($(1)) is available; install ss or lsof."; \
fi
endef

define stop_port
@if command -v lsof >/dev/null 2>&1; then \
	pids=$$(lsof -tiTCP:$($(1)) -sTCP:LISTEN 2>/dev/null | sort -u); \
	if [ -n "$$pids" ]; then \
		echo "Stopping $(2) service on port $($(1)) (PID $$pids)."; \
		kill $$pids 2>/dev/null || true; \
		sleep 1; \
		kill -9 $$pids 2>/dev/null || true; \
	fi; \
elif command -v powershell.exe >/dev/null 2>&1; then \
	powershell.exe -NoProfile -ExecutionPolicy Bypass -Command '& { $$port = [int]$($(1)); $$conns = @(Get-NetTCPConnection -LocalPort $$port -State Listen -ErrorAction SilentlyContinue); $$ownerIds = @($$conns | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $$_ -gt 0 }); foreach ($$ownerId in $$ownerIds) { $$children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$$ownerId" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessId); $$targets = @($$ownerId) + $$children | Select-Object -Unique; foreach ($$target in $$targets) { try { Stop-Process -Id $$target -Force -ErrorAction Stop; Write-Host "Stopped $(2) service on port $$port (PID $$target)." } catch {} } } }'; \
elif command -v powershell >/dev/null 2>&1; then \
	powershell -NoProfile -ExecutionPolicy Bypass -Command '& { $$port = [int]$($(1)); $$conns = @(Get-NetTCPConnection -LocalPort $$port -State Listen -ErrorAction SilentlyContinue); $$ownerIds = @($$conns | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $$_ -gt 0 }); foreach ($$ownerId in $$ownerIds) { $$children = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$$ownerId" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ProcessId); $$targets = @($$ownerId) + $$children | Select-Object -Unique; foreach ($$target in $$targets) { try { Stop-Process -Id $$target -Force -ErrorAction Stop; Write-Host "Stopped $(2) service on port $$port (PID $$target)." } catch {} } } }'; \
else \
	echo "Warning: cannot automatically clear port $($(1)); install lsof or PowerShell."; \
	fi
endef

define stop_backend_processes
@pids=$$(ps -eo pid=,args= | awk '/[u]vicorn aegra_api[.]main:app --host $(BACKEND_HOST) --port $(BACKEND_PORT)/ { print $$1 }' | sort -u); \
if [ -n "$$pids" ]; then \
	echo "Stopping stale backend process(es) on port $(BACKEND_PORT) (PID $$pids)."; \
	kill $$pids 2>/dev/null || true; \
	sleep 1; \
	kill -9 $$pids 2>/dev/null || true; \
fi
endef

check-backend-port:
	$(call check_port,BACKEND_PORT,Backend,backend)

check-frontend-port:
	$(call check_port,FRONTEND_PORT,Frontend,frontend)

check-ports: check-backend-port check-frontend-port

stop-backend-port:
	$(call stop_port,BACKEND_PORT,Backend)
	$(call stop_backend_processes)

stop-frontend-port:
	$(call stop_port,FRONTEND_PORT,Frontend)

stop-ports: stop-backend-port stop-frontend-port

# Run both frontend and backend concurrently
dev: dev-infra stop-ports
	@$(call run_concurrent,"$(MAKE)" dev-backend,$(call run_frontend_local))

# Frontend only (connects to the configured Aegra/LangGraph API)
dev-frontend: check-frontend-port
	$(call run_frontend,dev -- -H $(FRONTEND_HOST) -p $(FRONTEND_PORT))

# Frontend pointing to local backend
dev-local: dev-infra check-ports
	@$(call run_concurrent,"$(MAKE)" dev-backend,$(call run_frontend_local))

# Shared local infrastructure for dev processes running on the host.
dev-infra:
	SPEAKER_PORT=$(SPEAKER_PORT) docker compose up -d postgres redis speaker

# Backend only (Aegra dev server with hot reload)
dev-backend: dev-infra check-backend-port
	SPEAKER_SERVICE_URL=$${SPEAKER_SERVICE_URL:-http://127.0.0.1:$(SPEAKER_PORT)} $(AEGRA) dev --host $(BACKEND_HOST) --port $(BACKEND_PORT)

# Run both frontend and backend in local production mode
prod: check-ports build-frontend
	@$(call run_concurrent,"$(MAKE)" prod-backend,"$(MAKE)" start-frontend)

# Backend only (Aegra production server, no reload)
prod-backend: check-backend-port
	$(AEGRA) serve --host $(BACKEND_HOST) --port $(BACKEND_PORT)

build-frontend:
	$(call run_frontend,build)

# Frontend only (Next.js production server)
prod-frontend: check-frontend-port build-frontend start-frontend

start-frontend: check-frontend-port
	$(call run_frontend,start -- -H $(FRONTEND_HOST) -p $(FRONTEND_PORT))

# Deploy Aegra backend stack with Docker Compose.
# Aegra creates Dockerfile and docker-compose.yml if they do not exist.
deploy-prod:
	PORT=$(BACKEND_PORT) $(AEGRA) up --build

deploy-prod-no-build:
	PORT=$(BACKEND_PORT) $(AEGRA) up --no-build

# Deploy full stack including frontend
deploy-all:
	docker compose up --build -d

deploy-all-logs:
	docker compose logs -f frontend tobagent

deploy-down:
	$(AEGRA) down

deploy-logs:
	docker compose logs -f

# Install all dependencies
install: install-frontend install-backend

install-frontend:
	cd frontend && bun install

install-backend:
	uv sync

desktop: desktop-backend desktop-frontend desktop-tauri

desktop-backend:
	@if [ "$$(uname -s)" = "Linux" ] && ! command -v patchelf >/dev/null 2>&1; then \
		echo "Nuitka standalone builds on Linux require patchelf. Install it first, for example: sudo apt install patchelf"; \
		exit 1; \
	fi
	uv run python -m nuitka \
		--standalone \
		--assume-yes-for-downloads \
		--output-dir=desktop/dist \
		--output-filename=tobagent-backend \
		--include-data-dir=assets=assets \
		--include-data-dir=models=models \
		desktop/backend_entry.py
	mkdir -p desktop/dist/bin
	if [ -f desktop/dist/backend_entry.dist/tobagent-backend.exe ]; then \
		cp desktop/dist/backend_entry.dist/tobagent-backend.exe desktop/dist/bin/tobagent-backend.exe; \
	else \
		cp desktop/dist/backend_entry.dist/tobagent-backend desktop/dist/bin/tobagent-backend; \
	fi

desktop-frontend:
	cd frontend && bun run build:desktop

desktop-tauri:
	cd frontend && bun run tauri:build

# Rebuild bundled assets/ knowledge bases and remove stale asset KB records.
# Usage:
#   make update-assets
# Optional overrides:
#   DATABASE_URL=postgresql://...
#   LANCEDB_PATH=/path/to/lancedb
#   OPENAI_COMPATIBLE_BASE_URL=https://...
#   OPENAI_COMPATIBLE_API_KEY=...
#   OPENAI_EMBEDDING_MODEL=text-embedding-v4
update-assets:
	uv run python -m src.utils.assets_import --refresh

refresh-assets: update-assets

lint-actions:
	@if command -v actionlint >/dev/null 2>&1; then \
		actionlint -color; \
	else \
		tmpdir=$$(mktemp -d); \
		trap 'rm -rf "$$tmpdir"' EXIT; \
		curl -sSfL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash | bash -s -- latest "$$tmpdir"; \
		"$$tmpdir/actionlint" -color; \
	fi

# Test external LangGraph SDK invocation with a user-scoped API key.
# Usage:
#   make test-agent-sdk USER_API_KEY=<tob_...> TOB_AGENT_ID=<agent-profile-id>
# Optional overrides:
#   LANGGRAPH_API_URL=http://localhost:2025
#   LANGGRAPH_ASSISTANT_ID=generic_agent
#   MESSAGE="您好，我想咨询营业时间。"
#   SDK_LOG_FILE=logs/test-agent-sdk.log
test-agent-sdk:
	@if [ -z "$(USER_API_KEY)" ]; then \
		echo "USER_API_KEY is required. Usage: make test-agent-sdk USER_API_KEY=<tob_...> TOB_AGENT_ID=<agent-profile-id>"; \
		exit 1; \
	fi
	@uv run python $(SDK_TEST_SCRIPT) \
		--api-key "$(USER_API_KEY)" \
		--api-url "$(LANGGRAPH_API_URL)" \
		--assistant-id "$(LANGGRAPH_ASSISTANT_ID)" \
		--agent-id "$(TOB_AGENT_ID)" \
		--message "$(MESSAGE)" \
		--log-file "$(SDK_LOG_FILE)" \
		--verbose
