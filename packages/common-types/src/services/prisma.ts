/**
 * Prisma Client Service
 *
 * `createPrismaClient()` is the supported entry point — it builds an app-owned
 * client the caller injects + disposes. `getPrismaClient()` is the deprecated
 * cross-package singleton, retained only until its remaining consumers migrate.
 *
 * Prisma 7.0 uses driver adapters for database connections; the generated
 * PrismaClient lives in packages/common-types/src/generated/prisma/.
 */

import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { createLogger } from '../utils/logger.js';
import { getConfig } from '../config/config.js';
import {
  resolvePoolMax,
  resolveConnectionTimeoutMs,
  resolvePoolStatsIntervalMs,
  startPoolStatsGauge,
} from './poolConfig.js';

const logger = createLogger('PrismaService');
const config = getConfig();

let prismaClient: PrismaClient | null = null;

/**
 * A constructed Prisma client paired with its disposer. Each app constructs
 * exactly one of these at its composition root, injects `prisma` into the
 * services that need it, and calls `dispose()` in its shutdown handler.
 */
export interface PrismaClientHandle {
  prisma: PrismaClient;
  /** Stop the pool-stats gauge and disconnect the client (closes the pool). */
  dispose: () => Promise<void>;
}

/**
 * Construct a fresh PrismaClient over a configured pg.Pool. NOT a singleton —
 * each call builds an independent client + pool. The caller owns the lifecycle:
 * inject `prisma`, call `dispose()` on shutdown. An app-owned client (vs. a
 * shared cross-package singleton) keeps lifecycle ownership explicit.
 *
 * @param opts.max - Pool size override. Defaults to `resolvePoolMax()` (the
 *   long-running app size); pass `DB_POOL_DEFAULTS.TRANSIENT_MAX` for one-shot
 *   scripts/migrations that don't warrant the full pool.
 */
export function createPrismaClient(opts?: { max?: number }): PrismaClientHandle {
  const dbUrl = process.env.DATABASE_URL;

  // Prisma 7.0 driver adapter over an EXPLICIT pg.Pool. The adapter ignores
  // `?connection_limit=` on DATABASE_URL, so the pool MUST be sized here —
  // otherwise it silently uses pg's defaults (max=10, wait-forever acquisition)
  // and starves under load. See poolConfig.ts for the full rationale.
  const max = opts?.max ?? resolvePoolMax();
  const connectionTimeoutMillis = resolveConnectionTimeoutMs();
  const pool = new Pool({ connectionString: dbUrl, max, connectionTimeoutMillis });
  pool.on('error', err => {
    logger.error({ err }, 'pg.Pool idle-client error');
  });
  const stopGauge = startPoolStatsGauge(pool, logger, resolvePoolStatsIntervalMs(), max);

  // The pool + stats gauge are now live; if client construction throws past
  // this point, tear them down before rethrowing so we don't leak the interval
  // or pool connections (callers can't dispose a handle they never received).
  let prisma: PrismaClient;
  try {
    // disposeExternalPool: true so prisma.$disconnect() closes the pool we created
    // (external pools are otherwise left open on disconnect).
    const adapter = new PrismaPg(pool, { disposeExternalPool: true });
    prisma = new PrismaClient({
      adapter,
      log: config.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });
  } catch (err) {
    stopGauge();
    void pool.end();
    throw err;
  }

  logger.info(
    { max, connectionTimeoutMillis },
    'Prisma client initialized with configured pg.Pool'
  );

  let disposed = false;
  const dispose = async (): Promise<void> => {
    // Idempotent — the lifecycle pattern spreads to ai-worker (2p-1b), so a
    // double-call (shutdown + a stray finally) must not $disconnect twice.
    if (disposed) {
      return;
    }
    disposed = true;
    // Stop the gauge before disconnecting so no stale interval polls the closed
    // pool. `startPoolStatsGauge` always returns a function, so no `?.` needed.
    stopGauge();
    await prisma.$disconnect();
    logger.info('Prisma client disconnected');
  };

  return { prisma, dispose };
}

/**
 * Get or create the Prisma client singleton
 * Uses the Prisma 7.0 driver adapter pattern with @prisma/adapter-pg
 *
 * @deprecated Being evicted. Use `createPrismaClient()` at the app composition
 * root and inject the client. This singleton is removed once its remaining
 * consumers (ai-worker, the tooling db commands) are migrated off it.
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    const dbUrl = process.env.DATABASE_URL;

    // Prisma 7.0 driver adapter over an EXPLICIT pg.Pool. The adapter ignores
    // `?connection_limit=` on DATABASE_URL, so the pool MUST be sized here —
    // otherwise it silently uses pg's defaults (max=10, wait-forever acquisition)
    // and starves under load. See poolConfig.ts for the full rationale.
    const max = resolvePoolMax();
    const connectionTimeoutMillis = resolveConnectionTimeoutMs();
    const pool = new Pool({ connectionString: dbUrl, max, connectionTimeoutMillis });
    pool.on('error', err => {
      logger.error({ err }, 'pg.Pool idle-client error');
    });
    // No stop handle kept: this client is never disposed, so the gauge runs for
    // the process lifetime.
    startPoolStatsGauge(pool, logger, resolvePoolStatsIntervalMs(), max);

    // disposeExternalPool: true so prismaClient.$disconnect() closes the pool we
    // created (external pools are otherwise left open on disconnect).
    const adapter = new PrismaPg(pool, { disposeExternalPool: true });

    prismaClient = new PrismaClient({
      adapter,
      log: config.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
    });

    logger.info(
      { max, connectionTimeoutMillis },
      'Prisma client initialized with configured pg.Pool'
    );
  }

  return prismaClient;
}

// Re-export PrismaClient class and Prisma namespace for use by other services
// The PrismaClient is exported as both a value (class) and type
export { PrismaClient, Prisma } from '../generated/prisma/client.js';

// Explicitly re-export Null types from runtime library to fix TypeScript type inference
// issues with pnpm workspaces (TS2742 errors about non-portable type references)
