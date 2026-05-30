.PHONY: \
	dev dev-frontend dev-backend dev-local \
	prod prod-backend prod-frontend build-frontend start-frontend \
	deploy-prod deploy-prod-no-build deploy-down deploy-logs \
	check-backend-port check-frontend-port check-ports \
	install install-frontend install-backend

# Add standard Node.js and Bun paths to PATH for Windows/Git Bash users
export PATH := $(PATH):/c/Program Files/nodejs:$(HOME)/.bun/bin

BACKEND_HOST ?= 0.0.0.0
BACKEND_PORT ?= 2025
FRONTEND_HOST ?= 0.0.0.0
FRONTEND_PORT ?= 3000
AEGRA ?= $(shell if [ -x ./.venv/bin/aegra ]; then printf './.venv/bin/aegra'; else printf 'aegra'; fi)

define run_frontend
cd frontend && if command -v bun >/dev/null 2>&1; then \
	bun run $(1); \
else \
	npm run $(1); \
fi
endef

check-backend-port:
	@! ss -ltn "sport = :$(BACKEND_PORT)" | grep -q LISTEN || (echo "Backend port $(BACKEND_PORT) is already in use. Stop the existing backend or run with BACKEND_PORT=<port>."; exit 1)

check-frontend-port:
	@! ss -ltn "sport = :$(FRONTEND_PORT)" | grep -q LISTEN || (echo "Frontend port $(FRONTEND_PORT) is already in use. Stop the existing frontend or run with FRONTEND_PORT=<port>."; exit 1)

check-ports: check-backend-port check-frontend-port

# Run both frontend and backend concurrently
dev: check-ports
	@trap 'kill 0' INT TERM; \
	"$(MAKE)" dev-backend & \
	"$(MAKE)" dev-frontend & \
	wait

# Frontend only (connects to remote LangGraph API)
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
