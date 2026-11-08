# Fixture Dockerfile for watch-patterns tests
FROM node:24-slim AS builder

WORKDIR /app

# Multi-source line with --chown= flag
COPY --chown=node:node package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY docs/legal ./docs/legal
COPY docs/guides ./docs/guides
COPY docs/commands.md ./docs/commands.md

RUN pnpm install \
  --frozen-lockfile

FROM nginx:alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist ./dist
