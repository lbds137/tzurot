# Build stage
FROM node:22-slim AS builder

# Install pnpm
RUN npm install -g pnpm

# Set working directory to monorepo root
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/ ./packages/
COPY services/api-gateway/package.json ./services/api-gateway/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/ ./packages/
COPY services/api-gateway/ ./services/api-gateway/

# Build shared packages and service
RUN pnpm --filter @tzurot/common-types build
RUN pnpm --filter @tzurot/api-clients build
RUN pnpm --filter api-gateway build

# Production stage
FROM node:22-slim

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/common-types/package.json ./packages/common-types/
COPY packages/api-clients/package.json ./packages/api-clients/
COPY services/api-gateway/package.json ./services/api-gateway/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built artifacts
COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist
COPY --from=builder /app/packages/api-clients/dist ./packages/api-clients/dist
COPY --from=builder /app/services/api-gateway/dist ./services/api-gateway/dist

# Copy personality files
COPY personalities ./personalities

EXPOSE 3000

CMD ["node", "services/api-gateway/dist/index.js"]
