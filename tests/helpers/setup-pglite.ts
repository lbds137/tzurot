/**
 * Integration Test Setup
 *
 * Environment-aware setup:
 * - Local (no DATABASE_URL): Use PGlite (in-memory Postgres with pgvector) + Redis mock
 * - Local (with DATABASE_URL): Use real Postgres + Redis mock
 * - CI (GITHUB_ACTIONS): Use real Postgres + real Redis via Service Containers
 *
 * This allows integration tests to run anywhere without external dependencies.
 *
 * PGLite Schema Management:
 * - Schema SQL is auto-generated from Prisma using `prisma migrate diff`
 * - Stored in tests/schema/pglite-schema.sql
 * - Regenerate with: ./scripts/testing/regenerate-pglite-schema.sh
 * - This ensures PGLite always matches the current Prisma schema
 */

// Set up test environment variables before any imports
// This prevents config validation errors when importing services
process.env.PROD_DATABASE_URL ??= process.env.DATABASE_URL ?? '';

import { PrismaClient } from '@tzurot/common-types';
import { PrismaPg } from '@prisma/adapter-pg';
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { Redis as IORedis } from 'ioredis';
import { createRedisClientMock } from './RedisClientMock.js';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface TestEnvironment {
  prisma: PrismaClient;
  redis: IORedis;
  cleanup: () => Promise<void>;
}

// Store PGlite instance for cleanup
let pgliteInstance: PGlite | null = null;

/**
 * Detect if we're running in CI (GitHub Actions)
 * NOTE: Pre-push hook sets CI=true, but we only want real Redis/Postgres in actual CI
 */
export function isCI(): boolean {
  return process.env.GITHUB_ACTIONS === 'true';
}

// Get the directory of this file for resolving the schema path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Load the pre-generated PGLite schema SQL.
 * This SQL is generated from Prisma schema using `prisma migrate diff`.
 * Regenerate with: ./scripts/testing/regenerate-pglite-schema.sh
 */
function loadPGliteSchema(): string {
  const schemaPath = join(__dirname, '../schema/pglite-schema.sql');
  try {
    return readFileSync(schemaPath, 'utf-8');
  } catch {
    throw new Error(
      `Failed to load PGLite schema from ${schemaPath}. ` +
        `Run ./scripts/testing/regenerate-pglite-schema.sh to generate it.`
    );
  }
}

/**
 * Initialize PGlite with the schema from Prisma.
 * Uses pre-generated SQL to ensure schema is always in sync with prisma/schema.prisma.
 */
async function initializePGliteSchema(pglite: PGlite): Promise<void> {
  const schemaSql = loadPGliteSchema();

  // Execute the entire SQL as one block - pglite.exec() handles multi-statement SQL
  // Do NOT split by semicolons as that breaks statements with embedded semicolons
  // Note: CREATE EXTENSION is included in the SQL and works with PGLite when the
  // extension is loaded via JS constructor (extensions: { vector })
  try {
    await pglite.exec(schemaSql);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to initialize PGLite schema: ${message}`);
  }
}

/**
 * Set up local test environment with PGlite (no external database needed)
 */
async function setupPGlite(): Promise<TestEnvironment> {
  // Create PGlite instance with pgvector extension
  pgliteInstance = new PGlite({
    extensions: { vector },
  });

  // Initialize schema from pre-generated SQL (ensures sync with Prisma schema)
  await initializePGliteSchema(pgliteInstance);

  // Create Prisma adapter for PGlite
  const adapter = new PrismaPGlite(pgliteInstance);
  const prisma = new PrismaClient({ adapter }) as PrismaClient;

  // Create Redis mock (ioredis-compatible)
  const redis: IORedis = createRedisClientMock() as unknown as IORedis;

  return {
    prisma,
    redis,
    cleanup: async () => {
      await prisma.$disconnect();
      await redis.quit();
      if (pgliteInstance) {
        await pgliteInstance.close();
        pgliteInstance = null;
      }
    },
  };
}

/**
 * Set up local test environment with real Postgres from DATABASE_URL
 */
function setupWithRealDatabase(): TestEnvironment {
  const databaseUrl = process.env.DATABASE_URL ?? '';

  // Use driver adapter pattern for Prisma 7
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  // Create a Redis mock instance for local development (ioredis-compatible)
  const redis: IORedis = createRedisClientMock() as unknown as IORedis;

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
 * Uses ioredis (unified Redis client for all services - BullMQ requires it anyway)
 */
function setupCI(): TestEnvironment {
  // In CI, use environment variables pointing to service containers
  // prettier-ignore
  const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/tzurot_test'; // secretlint-disable-line
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';

  // Use driver adapter pattern for Prisma 7
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  const prisma = new PrismaClient({ adapter });

  // Parse Redis URL for ioredis (connects lazily)
  const url = new URL(redisUrl);
  const redis: IORedis = new IORedis({
    host: url.hostname,
    port: parseInt(url.port, 10) || 6379,
    password: url.password || undefined,
    username: url.username || undefined,
  });

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
  } else if (process.env.DATABASE_URL !== undefined && process.env.DATABASE_URL.length > 0) {
    // If DATABASE_URL is set locally, use real database
    return setupWithRealDatabase();
  } else {
    // Default: use PGlite (no external dependencies)
    return setupPGlite();
  }
}
