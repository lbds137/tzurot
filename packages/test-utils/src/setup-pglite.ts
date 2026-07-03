/**
 * Component/Contract Test Setup
 *
 * Redis: a REAL ioredis connection in every environment (local, pre-push, CI),
 * scoped to a dedicated logical DB (db 15) that is flushed on setup + cleanup.
 * There is no mock — a mock that disagrees with real Redis is a source of false
 * confidence, and "green locally" must mean the same thing as "green in CI".
 *
 * PGLite Schema Management:
 * - Schema SQL is auto-generated from Prisma using `prisma migrate diff`
 *   plus a sweep of migration SQL for CHECK constraints (which Prisma's
 *   schema-diff can't represent on its own)
 * - Stored in packages/test-utils/schema/pglite-schema.sql
 * - Regenerate with: pnpm ops test:generate-schema
 * - This ensures PGLite always matches the current Prisma schema
 */

import { PGlite } from '@electric-sql/pglite';
// pglite 0.5 extracted pgvector into a standalone package; citext stays in core contrib.
import { vector } from '@electric-sql/pglite-pgvector';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { Redis as IORedis } from 'ioredis';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Test environment interface
 * - redis: a real ioredis connection on the dedicated test DB (db 15)
 * - prisma: Optional - tests that need it should set it up themselves
 * - cleanup: Function to clean up resources
 */
export interface TestEnvironment {
  redis: IORedis;
  prisma?: unknown; // Optional - tests add their own PrismaClient
  cleanup: () => Promise<void>;
}

/**
 * Dedicated Redis logical DB for tests. Real data lives on db 0; tests run on
 * db 15 and flush it on setup + cleanup, so a test run is isolated per file and
 * can never clobber other data even if REDIS_URL points at a shared instance.
 */
const TEST_REDIS_DB = 15;

// Get the directory of this file for resolving the schema path
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Create a PGLite instance pre-configured with the project's standard
 * Postgres extension set (`vector`, `citext`).
 *
 * Prefer this over `new PGlite({ extensions: { vector, citext } })` in
 * `.component.test.ts` / `.integration.test.ts` / `.contract.test.ts` files — when a new extension is added
 * to the standard set, the change lands here once instead of at every call site.
 *
 * @example
 * ```typescript
 * import { createTestPGlite, loadPGliteSchema } from '@tzurot/test-utils';
 * import { PrismaPGlite } from 'pglite-prisma-adapter';
 * import { PrismaClient } from '@tzurot/common-types/services/prisma';
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
 * This SQL is generated from Prisma schema using `prisma migrate diff`
 * plus a sweep of migration SQL for CHECK constraints (see
 * `packages/tooling/src/test/generate-schema.ts`).
 * Regenerate with: pnpm ops test:generate-schema
 */
export function loadPGliteSchema(): string {
  const schemaPath = join(__dirname, '../schema/pglite-schema.sql');
  try {
    return readFileSync(schemaPath, 'utf-8');
  } catch {
    throw new Error(
      `Failed to load PGLite schema from ${schemaPath}. ` +
        `Run pnpm ops test:generate-schema to generate it.`
    );
  }
}

/**
 * Set up test environment with Redis (automatically detects CI vs local)
 *
 * For tests that need Prisma/PGLite, set it up in the test file:
 * @example
 * ```typescript
 * import { PrismaClient } from '@tzurot/common-types/services/prisma';
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
export async function setupTestEnvironment(): Promise<TestEnvironment> {
  const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
  const url = new URL(redisUrl);
  const port = parseInt(url.port, 10) || 6379;
  const redis = new IORedis({
    host: url.hostname,
    port,
    password: url.password || undefined,
    username: url.username || undefined,
    db: TEST_REDIS_DB,
    // Fail fast with a clear message instead of hanging when Redis is down.
    lazyConnect: true,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
  });

  // ioredis crashes the process on an unhandled 'error' event; swallow it here.
  // Command-level failures still reject their own promises, so tests fail loudly.
  redis.on('error', () => undefined);

  try {
    await redis.connect();
  } catch (err) {
    throw new Error(
      `Test Redis is unreachable at ${url.hostname}:${port}. ` +
        'Start the container: `podman start tzurot-redis`. ' +
        `(${err instanceof Error ? err.message : String(err)})`,
      { cause: err }
    );
  }

  // Each test file starts from a clean DB (component/contract runs are sequential).
  await redis.flushdb();

  return {
    redis,
    cleanup: async () => {
      await redis.flushdb().catch(() => undefined);
      await redis.quit().catch(() => undefined);
    },
  };
}
