# syntax=docker/dockerfile:1

# ---- Stage 1: Install dependencies ----
FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile

# ---- Stage 2: Build ----
FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Build-time env vars (baked into the JS bundle)
ARG NEXT_PUBLIC_OPENAI_DEFAULT_MODEL
ARG NEXT_PUBLIC_LANGGRAPH_API_URL
ARG NEXT_PUBLIC_SHOW_MIC_DEVICE_DEBUG
ARG NEXT_PUBLIC_ADMIN_URL

ENV NEXT_PUBLIC_OPENAI_DEFAULT_MODEL=${NEXT_PUBLIC_OPENAI_DEFAULT_MODEL} \
    NEXT_PUBLIC_LANGGRAPH_API_URL=${NEXT_PUBLIC_LANGGRAPH_API_URL} \
    NEXT_PUBLIC_SHOW_MIC_DEVICE_DEBUG=${NEXT_PUBLIC_SHOW_MIC_DEVICE_DEBUG} \
    NEXT_PUBLIC_ADMIN_URL=${NEXT_PUBLIC_ADMIN_URL}

RUN --mount=type=cache,target=/app/.next/cache \
    bun run build

# ---- Stage 3: Production runtime ----
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
    && adduser --system --uid 1001 nextjs

# Copy standalone server + static assets
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000 HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
