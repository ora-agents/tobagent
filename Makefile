.PHONY: dev dev-frontend dev-backend dev-local install install-frontend install-backend

# Run both frontend and backend concurrently
dev:
	@trap 'kill 0' SIGINT; \
	$(MAKE) dev-backend & \
	$(MAKE) dev-frontend & \
	wait

# Frontend only (connects to remote LangGraph API)
dev-frontend:
	cd frontend && bun run dev

# Frontend pointing to local backend
dev-local:
	@trap 'kill 0' SIGINT; \
	$(MAKE) dev-backend & \
	cd frontend && bun run dev:local & \
	wait

# Backend only (LangGraph dev server)
dev-backend:
	uv run langgraph dev --no-browser --allow-blocking

# Install all dependencies
install: install-frontend install-backend

install-frontend:
	cd frontend && bun install

install-backend:
	uv sync
