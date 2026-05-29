.PHONY: dev dev-frontend dev-backend dev-local install install-frontend install-backend

# Add standard Node.js and Bun paths to PATH for Windows/Git Bash users
export PATH := $(PATH):/c/Program Files/nodejs:$(HOME)/.bun/bin

# Run both frontend and backend concurrently
dev:
	@trap 'kill 0' SIGINT; \
	"$(MAKE)" dev-backend & \
	"$(MAKE)" dev-frontend & \
	wait

# Frontend only (connects to remote LangGraph API)
dev-frontend:
	cd frontend && (command -v bun >/dev/null 2>&1 && bun run dev -- -H 0.0.0.0 || npm run dev -- -H 0.0.0.0)

# Frontend pointing to local backend
dev-local:
	@trap 'kill 0' SIGINT; \
	"$(MAKE)" dev-backend & \
	cd frontend && (command -v bun >/dev/null 2>&1 && bun run dev:local || npm run dev:local) & \
	wait

# Backend only (LangGraph dev server)
dev-backend:
	uv run langgraph dev --no-browser --host 0.0.0.0 --port 2025

# Install all dependencies
install: install-frontend install-backend

install-frontend:
	cd frontend && (command -v bun >/dev/null 2>&1 && bun install || npm install)

install-backend:
	uv sync
