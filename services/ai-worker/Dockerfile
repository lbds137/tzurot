# Build stage
FROM node:25-slim AS builder

# Install OpenSSL for Prisma
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

# Set working directory to monorepo root
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/ ./packages/
COPY services/ai-worker/package.json ./services/ai-worker/
COPY prisma ./prisma

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY packages/ ./packages/
COPY services/ai-worker/ ./services/ai-worker/

# Build shared packages and service
RUN pnpm --filter @tzurot/common-types build
RUN pnpm --filter ai-worker build

# Production stage
FROM node:25-slim

# Install OpenSSL for Prisma runtime (required in both build and prod stages)
# Prisma needs OpenSSL to run queries, not just to generate the client
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/common-types/package.json ./packages/common-types/
COPY services/ai-worker/package.json ./services/ai-worker/
COPY prisma ./prisma

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy entire pnpm store to preserve generated Prisma client
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm

# Copy built artifacts
COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist
COPY --from=builder /app/services/ai-worker/dist ./services/ai-worker/dist

CMD ["node", "services/ai-worker/dist/index.js"]
