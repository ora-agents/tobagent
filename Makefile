.PHONY: \
	dev dev-frontend dev-backend dev-local \
	prod prod-backend prod-frontend build-frontend start-frontend \
	deploy-prod deploy-prod-no-build deploy-down deploy-logs \
	check-backend-port check-frontend-port check-ports \
	stop-backend-port stop-frontend-port stop-ports \
	install install-frontend install-backend \
	test-agent-sdk

# Add standard Node.js and Bun paths to PATH for Windows/Git Bash users
export PATH := $(PATH):/c/Program Files/nodejs:$(HOME)/.bun/bin

BACKEND_HOST ?= 0.0.0.0
BACKEND_PORT ?= 2025
FRONTEND_HOST ?= 0.0.0.0
FRONTEND_PORT ?= 3000
AEGRA ?= $(shell if [ -x ./.venv/bin/aegra ]; then printf './.venv/bin/aegra'; else printf 'aegra'; fi)
SDK_TEST_SCRIPT ?= scripts/langgraph_sdk_external_call.py
LANGGRAPH_API_URL ?= http://localhost:2025
LANGGRAPH_ASSISTANT_ID ?= generic_agent
TOB_AGENT_ID ?= cfd97b38-0751-4a88-b441-8424db410f81
MESSAGE ?= 你可以调用子智能体吗？

define run_frontend
cd frontend && if command -v bun >/dev/null 2>&1; then \
	bun run $(1); \
else \
	npm run $(1); \
fi
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

check-backend-port:
	$(call check_port,BACKEND_PORT,Backend,backend)

check-frontend-port:
	$(call check_port,FRONTEND_PORT,Frontend,frontend)

check-ports: check-backend-port check-frontend-port

stop-backend-port:
	$(call stop_port,BACKEND_PORT,Backend)

stop-frontend-port:
	$(call stop_port,FRONTEND_PORT,Frontend)

stop-ports: stop-backend-port stop-frontend-port

# Run both frontend and backend concurrently
dev: stop-ports
	@trap 'kill 0' INT TERM; \
	"$(MAKE)" dev-backend & \
	"$(MAKE)" dev-frontend & \
	wait

# Frontend only (connects to the configured Aegra/LangGraph API)
dev-frontend: check-frontend-port
	$(call run_frontend,dev -- -H $(FRONTEND_HOST) -p $(FRONTEND_PORT))

# Frontend pointing to local backend
dev-local: check-ports
	@trap 'kill 0' INT TERM; \
	"$(MAKE)" dev-backend & \
	(cd frontend && if command -v bun >/dev/null 2>&1; then bun run dev -- -H $(FRONTEND_HOST) -p $(FRONTEND_PORT); else npm run dev -- -H $(FRONTEND_HOST) -p $(FRONTEND_PORT); fi) & \
	wait

# Backend only (Aegra dev server with hot reload)
dev-backend: check-backend-port
	$(AEGRA) dev --host $(BACKEND_HOST) --port $(BACKEND_PORT) --no-db-check

# Run both frontend and backend in local production mode
prod: check-ports build-frontend
	@trap 'kill 0' INT TERM; \
	"$(MAKE)" prod-backend & \
	"$(MAKE)" start-frontend & \
	wait

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

deploy-down:
	$(AEGRA) down

deploy-logs:
	docker compose logs -f

# Install all dependencies
install: install-frontend install-backend

install-frontend:
	cd frontend && if command -v bun >/dev/null 2>&1; then bun install; else npm install; fi

install-backend:
	uv sync

# Test external LangGraph SDK invocation with a user-scoped API key.
# Usage:
#   make test-agent-sdk USER_API_KEY=<tob_...> TOB_AGENT_ID=<agent-profile-id>
# Optional overrides:
#   LANGGRAPH_API_URL=http://localhost:2025
#   LANGGRAPH_ASSISTANT_ID=generic_agent
#   MESSAGE="您好，我想咨询营业时间。"
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
		--message "$(MESSAGE)"
