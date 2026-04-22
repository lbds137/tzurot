/**
 * Integration Test Setup
 *
 * Environment-aware setup:
 * - Local: Use Redis mock (optionally PGlite for database tests)
 * - CI (GITHUB_ACTIONS): Use real Redis via Service Containers
 *
 * PGLite Schema Management:
 * - Schema SQL is auto-generated from Prisma using `prisma migrate diff`
 * - Stored in packages/test-utils/schema/pglite-schema.sql
 * - Regenerate with: ./scripts/testing/regenerate-pglite-schema.sh
 * - This ensures PGLite always matches the current Prisma schema
 */

import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { Redis as IORedis } from 'ioredis';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRedisClientMock } from './RedisClientMock.js';

/**
 * Test environment interface
 * - redis: Always available (mock or real based on environment)
 * - prisma: Optional - tests that need it should set it up themselves
 * - cleanup: Function to clean up resources
 */
export interface TestEnvironment {
  redis: IORedis;
  prisma?: unknown; // Optional - tests add their own PrismaClient
  cleanup: () => Promise<void>;
}

/**
 * Detect if we're running in CI (GitHub Actions)
 * NOTE: Pre-push hook sets CI=true, but we only want real Redis/Postgres in actual CI
 */
function isCI(): boolean {
  return process.env.GITHUB_ACTIONS === 'true';
}

// Get the directory of this file for resolving the schema path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Create a PGLite instance pre-configured with the project's standard
 * Postgres extension set (`vector`, `citext`).
 *
 * Prefer this over `new PGlite({ extensions: { vector, citext } })` in
 * `.int.test.ts` / `.e2e.test.ts` files — when a new extension is added
 * to the standard set, the change lands here once instead of at every call site.
 *
 * @example
 * ```typescript
 * import { createTestPGlite, loadPGliteSchema } from '@tzurot/test-utils';
 * import { PrismaPGlite } from 'pglite-prisma-adapter';
 * import { PrismaClient } from '@tzurot/common-types';
 *
 * const pglite = createTestPGlite();
 * await pglite.exec(loadPGliteSchema());
 * const adapter = new PrismaPGlite(pglite);
 * const prisma = new PrismaClient({ adapter });
 * ```
 */
export function createTestPGlite(): PGlite {
  return new PGlite({ extensions: { vector, citext } });
}

/**
 * Load the pre-generated PGLite schema SQL.
 * This SQL is generated from Prisma schema using `prisma migrate diff`.
 * Regenerate with: ./scripts/testing/regenerate-pglite-schema.sh
 */
export function loadPGliteSchema(): string {
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
 * Set up test environment with Redis (automatically detects CI vs local)
 *
 * For tests that need Prisma/PGLite, set it up in the test file:
 * @example
 * ```typescript
 * import { PrismaClient } from '@tzurot/common-types';
 * import { PrismaPGlite } from 'pglite-prisma-adapter';
 * import {
 *   setupTestEnvironment,
 *   createTestPGlite,
 *   loadPGliteSchema,
 * } from '@tzurot/test-utils';
 *
 * let testEnv = await setupTestEnvironment();
 * const pglite = createTestPGlite();
 * await pglite.exec(loadPGliteSchema());
 * const adapter = new PrismaPGlite(pglite);
 * testEnv.prisma = new PrismaClient({ adapter });
 * ```
 */
export function setupTestEnvironment(): Promise<TestEnvironment> {
  if (isCI()) {
    // In CI, use real Redis from service containers
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const url = new URL(redisUrl);
    const redis: IORedis = new IORedis({
      host: url.hostname,
      port: parseInt(url.port, 10) || 6379,
      password: url.password || undefined,
      username: url.username || undefined,
    });

    return Promise.resolve({
      redis,
      cleanup: async () => {
        await redis.quit();
      },
    });
  } else {
    // Local: use Redis mock
    const redis: IORedis = createRedisClientMock();

    return Promise.resolve({
      redis,
      cleanup: async () => {
        await redis.quit();
      },
    });
  }
}
