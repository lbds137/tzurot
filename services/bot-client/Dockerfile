# Build stage
FROM node:22-slim AS builder

# Install pnpm
RUN npm install -g pnpm

# Set working directory to monorepo root
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/ ./packages/
COPY services/bot-client/package.json ./services/bot-client/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY packages/ ./packages/
COPY services/bot-client/ ./services/bot-client/

# Build shared packages and service
RUN pnpm --filter @tzurot/common-types build
RUN pnpm --filter bot-client build

# Production stage
FROM node:22-slim

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/common-types/package.json ./packages/common-types/
COPY services/bot-client/package.json ./services/bot-client/

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy built artifacts
COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist
COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist

# Copy personality files
COPY personalities ./personalities

CMD ["node", "services/bot-client/dist/index.js"]
