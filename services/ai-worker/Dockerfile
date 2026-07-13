# =============================================================================
# AI Worker Dockerfile - Using turbo prune for automatic dependency handling
# =============================================================================
# When adding new workspace packages as dependencies, turbo prune automatically
# includes them - no manual Dockerfile updates needed.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Prune the monorepo to only include what ai-worker needs
# -----------------------------------------------------------------------------
FROM node:25-slim AS pruner

RUN npm install -g turbo pnpm

WORKDIR /app

# Copy entire monorepo for turbo to analyze dependencies
COPY . .

# Prune to only packages needed by ai-worker
# This creates out/json (package.jsons only) and out/full (with source)
RUN turbo prune @tzurot/ai-worker --docker

# -----------------------------------------------------------------------------
# Stage 2: Install dependencies using pruned package.json files
# -----------------------------------------------------------------------------
FROM node:25-slim AS installer

# Install OpenSSL for Prisma (required at both build and runtime)
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app

# Copy pruned package.json files (enables better Docker layer caching)
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

# Copy prisma schema (needed for generate)
COPY prisma ./prisma

# Install all dependencies (dev deps needed for build)
RUN pnpm install --frozen-lockfile

# -----------------------------------------------------------------------------
# Stage 3: Build the application
# -----------------------------------------------------------------------------
FROM installer AS builder

# Copy pruned source code
COPY --from=pruner /app/out/full/ .

# Copy root tsconfig.json (not included in turbo prune output but needed for builds)
COPY tsconfig.json ./

# Generate Prisma client AFTER copying source (so it's not overwritten by COPY)
RUN npx prisma generate

# Build all packages in dependency order (turbo handles this automatically)
RUN pnpm turbo run build --filter=@tzurot/ai-worker...

# -----------------------------------------------------------------------------
# Stage 4: Production runtime
# -----------------------------------------------------------------------------
FROM node:25-slim AS runner

# Install OpenSSL for Prisma runtime (required for query execution).
# Install ffmpeg for audio post-processing — output-side EBU R128 loudness
# normalization in audioNormalizer.ts shells out to ffmpeg loudnorm.
RUN apt-get update -y && apt-get install -y openssl ffmpeg && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm

WORKDIR /app

# Copy pruned package.json files for production install
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml
COPY prisma ./prisma

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy Prisma client from builder (generated in node_modules/.pnpm)
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm

# Copy built artifacts from all workspace packages
COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist
COPY --from=builder /app/packages/config-resolver/dist ./packages/config-resolver/dist
COPY --from=builder /app/packages/identity/dist ./packages/identity/dist
COPY --from=builder /app/packages/conversation-history/dist ./packages/conversation-history/dist
COPY --from=builder /app/packages/cache-invalidation/dist ./packages/cache-invalidation/dist
COPY --from=builder /app/packages/embeddings/dist ./packages/embeddings/dist
# Vendored embedding model — the worker loads it from ../models relative to
# dist, so service boot never depends on a HuggingFace download (anonymous
# fetches 403 from datacenter IPs).
COPY --from=builder /app/packages/embeddings/models ./packages/embeddings/models
COPY --from=builder /app/services/ai-worker/dist ./services/ai-worker/dist

CMD ["node", "services/ai-worker/dist/index.js"]
