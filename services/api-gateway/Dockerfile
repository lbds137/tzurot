# =============================================================================
# API Gateway Dockerfile - Using turbo prune for automatic dependency handling
# =============================================================================
# When adding new workspace packages as dependencies, turbo prune automatically
# includes them - no manual Dockerfile updates needed.
# =============================================================================

# -----------------------------------------------------------------------------
# Stage 1: Prune the monorepo to only include what api-gateway needs
# -----------------------------------------------------------------------------
FROM node:25-slim AS pruner

RUN npm install -g turbo pnpm

WORKDIR /app

# Copy entire monorepo for turbo to analyze dependencies
COPY . .

# Prune to only packages needed by api-gateway
# This creates out/json (package.jsons only) and out/full (with source)
RUN turbo prune @tzurot/api-gateway --docker

# -----------------------------------------------------------------------------
# Stage 2: Install dependencies using pruned package.json files
# -----------------------------------------------------------------------------
FROM node:25-slim AS installer

RUN npm install -g pnpm

WORKDIR /app

# Copy pruned package.json files (enables better Docker layer caching)
COPY --from=pruner /app/out/json/ .
COPY --from=pruner /app/out/pnpm-lock.yaml ./pnpm-lock.yaml

# Copy prisma schema (needed for generate)
COPY prisma ./prisma

# Install all dependencies (dev deps needed for build)
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN npx prisma generate

# -----------------------------------------------------------------------------
# Stage 3: Build the application
# -----------------------------------------------------------------------------
FROM installer AS builder

# Copy pruned source code
COPY --from=pruner /app/out/full/ .

# Copy root tsconfig.json (not included in turbo prune output but needed for builds)
COPY tsconfig.json ./

# Build all packages in dependency order (turbo handles this automatically)
RUN pnpm turbo run build --filter=@tzurot/api-gateway...

# -----------------------------------------------------------------------------
# Stage 4: Production runtime
# -----------------------------------------------------------------------------
FROM node:25-slim AS runner

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
COPY --from=builder /app/packages/embeddings/dist ./packages/embeddings/dist
COPY --from=builder /app/services/api-gateway/dist ./services/api-gateway/dist

EXPOSE 3000

CMD ["node", "services/api-gateway/dist/index.js"]
