# Build stage
FROM node:25-slim AS builder

# Install pnpm
RUN npm install -g pnpm

# Set working directory to monorepo root
WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/ ./packages/
COPY services/bot-client/package.json ./services/bot-client/
COPY prisma ./prisma

# Install dependencies
RUN pnpm install --frozen-lockfile

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY packages/ ./packages/
COPY services/bot-client/ ./services/bot-client/

# Build shared packages and service
RUN pnpm --filter @tzurot/common-types build
RUN pnpm --filter bot-client build

# Production stage
FROM node:25-slim

# Install pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/common-types/package.json ./packages/common-types/
COPY services/bot-client/package.json ./services/bot-client/
COPY prisma ./prisma

# Install production dependencies only
RUN pnpm install --prod --frozen-lockfile

# Copy entire pnpm store to preserve generated Prisma client
COPY --from=builder /app/node_modules/.pnpm ./node_modules/.pnpm

# Copy built artifacts
COPY --from=builder /app/packages/common-types/dist ./packages/common-types/dist
COPY --from=builder /app/services/bot-client/dist ./services/bot-client/dist

CMD ["node", "services/bot-client/dist/index.js"]
