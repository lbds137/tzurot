/**
 * Integration Test Setup
 *
 * Simplified approach:
 * - Local: Use ioredis-mock for Redis (no Docker needed), real DATABASE_URL for Postgres
 * - CI: Real Postgres + Redis via Service Containers
 *
 * Environment detection automatically selects the appropriate setup.
 */

// Set up test environment variables before any imports
// This prevents config validation errors when importing services
if (!process.env.PROD_DATABASE_URL) {
  // Use the same DATABASE_URL for PROD in tests
  process.env.PROD_DATABASE_URL = process.env.DATABASE_URL || '';
}

import { PrismaClient } from '@prisma/client';
import type { RedisClientType } from 'redis';
import { createClient } from 'redis';
import { createRedisClientMock } from './helpers/RedisClientMock';

export interface TestEnvironment {
  prisma: PrismaClient;
  redis: RedisClientType;
  cleanup: () => Promise<void>;
}

/**
 * Detect if we're running in CI (GitHub Actions)
 */
export function isCI(): boolean {
  return process.env.CI === 'true' || process.env.GITHUB_ACTIONS === 'true';
}

/**
 * Set up local test environment
 * Uses real Postgres from DATABASE_URL, mocked Redis
 */
async function setupLocal(): Promise<TestEnvironment> {
  // Use the real DATABASE_URL (Railway dev database or local Postgres)
  // This simplifies setup - no need for PGlite complexity
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required for integration tests. Set it to your development database.'
    );
  }

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  // Create a Redis mock instance for local development
  // This avoids needing Redis running locally
  const redis = createRedisClientMock();

  return {
    prisma,
    redis,
    cleanup: async () => {
      await prisma.$disconnect();
      await redis.quit();
    },
  };
}

/**
 * Set up CI test environment (real Postgres + Redis)
 */
async function setupCI(): Promise<TestEnvironment> {
  // In CI, use environment variables pointing to service containers
  const databaseUrl = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/tzurot_test';
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });

  // Create Redis client
  const redis = createClient({ url: redisUrl });
  await redis.connect();

  // Run migrations
  // Note: This assumes migrations have been applied to the test database
  // We may need to run `npx prisma migrate deploy` in CI setup

  return {
    prisma,
    redis,
    cleanup: async () => {
      await prisma.$disconnect();
      await redis.quit();
    },
  };
}

/**
 * Set up test environment (automatically detects CI vs local)
 */
export async function setupTestEnvironment(): Promise<TestEnvironment> {
  if (isCI()) {
    return setupCI();
  } else {
    return setupLocal();
  }
}
