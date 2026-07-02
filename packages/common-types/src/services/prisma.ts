/**
 * Prisma Client Service
 *
 * `createPrismaClient()` is the entry point — it builds an app-owned client the
 * caller injects into the services that need it and disposes at shutdown. There
 * is no shared singleton: lifecycle ownership lives with each app.
 *
 * Prisma 7.0 uses driver adapters for database connections; the generated
 * PrismaClient lives in packages/common-types/src/generated/prisma/.
 */

import { Pool, type PoolConfig } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { createLogger } from '../utils/logger.js';
import { getConfig } from '../config/config.js';
import {
  resolvePoolMax,
  resolveConnectionTimeoutMs,
  resolvePoolStatsIntervalMs,
  mainPoolConnectionOptions,
  startPoolStatsGauge,
} from './poolConfig.js';

const logger = createLogger('PrismaService');
const config = getConfig();

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

export interface CreatePrismaClientOptions {
  /**
   * Pool-size override. Defaults to `resolvePoolMax()` (the long-running app
   * size); pass `DB_POOL_DEFAULTS.TRANSIENT_MAX` for one-shot scripts/migrations.
   */
  max?: number;
  /**
   * Extra `pg.Pool` fields, spread LAST over the base config. Omitted → the
   * main pool's behavior is unchanged. The fast pool (conversation-event
   * persist writes) passes `query_timeout` / `keepAlive` + the GUC `options`
   * startup string + a tighter `connectionTimeoutMillis` via
   * `fastPoolConnectionOptions().poolOverrides`.
   */
  poolOverrides?: Partial<PoolConfig>;
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
 * @param opts.poolOverrides - Extra `pg.Pool` fields (fast pool: timeouts +
 *   GUC `options` startup string). Omitted → main-pool behavior unchanged.
 */
export function createPrismaClient(opts?: CreatePrismaClientOptions): PrismaClientHandle {
  const dbUrl = process.env.DATABASE_URL;

  // Prisma 7.0 driver adapter over an EXPLICIT pg.Pool. The adapter ignores
  // `?connection_limit=` on DATABASE_URL, so the pool MUST be sized here —
  // otherwise it silently uses pg's defaults (max=10, wait-forever acquisition)
  // and starves under load. See poolConfig.ts for the full rationale.
  const max = opts?.max ?? resolvePoolMax();
  const connectionTimeoutMillis = resolveConnectionTimeoutMs();
  // Base config carries the main-pool hardening (keepAlive + explicit idle
  // eviction + a safe pool-wide lock_timeout — see mainPoolConnectionOptions).
  // poolOverrides spread LAST so the fast pool can override any of it: its
  // tighter ladder, keepAlive knobs, and its own `options` GUC string fully
  // replace the base values without disturbing every other pool.
  const pool = new Pool({
    connectionString: dbUrl,
    max,
    connectionTimeoutMillis,
    ...mainPoolConnectionOptions(),
    ...opts?.poolOverrides,
  });
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
    pool
      .end()
      .catch(poolErr =>
        logger.warn({ err: poolErr }, 'pool.end() failed during construction-cleanup')
      );
    throw err;
  }

  logger.info(
    { max, connectionTimeoutMillis },
    'Prisma client initialized with configured pg.Pool'
  );

  let disposed = false;
  const dispose = async (): Promise<void> => {
    // Idempotent: a double-call (e.g. a shutdown handler plus a stray finally)
    // must not $disconnect twice.
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
 * Boot-time probe: assert the fast pool's `statement_timeout` / `lock_timeout`
 * GUCs actually applied through the adapter, throwing (failing boot) on
 * mismatch. Guards against a connection pooler silently stripping the Postgres
 * `options` startup string — which would revert us to the silent-hang bug with
 * no signal. Runs through the PrismaClient (the same connection path the app
 * uses), so it verifies adapter-drawn connections carry the GUCs.
 *
 * `pg_settings.setting` reports each timeout in its base unit (ms), so the
 * comparison is a direct integer match — robust to the `current_setting()`
 * `'5s'`-style human normalization.
 */
export async function verifyPoolTimeouts(
  prisma: PrismaClient,
  expected: { statementTimeoutMs: number; lockTimeoutMs: number }
): Promise<void> {
  const rows = await prisma.$queryRaw<{ name: string; setting: string }[]>`
    SELECT name, setting FROM pg_settings WHERE name IN ('statement_timeout', 'lock_timeout')
  `;
  const got: Record<string, number> = {};
  for (const row of rows) {
    got[row.name] = Number(row.setting);
  }
  if (
    got.statement_timeout !== expected.statementTimeoutMs ||
    got.lock_timeout !== expected.lockTimeoutMs
  ) {
    throw new Error(
      `Fast-pool DB timeouts did not apply: expected statement_timeout=` +
        `${expected.statementTimeoutMs}ms, lock_timeout=${expected.lockTimeoutMs}ms; got ` +
        `${JSON.stringify(got)}. The Postgres 'options' startup string was likely stripped ` +
        `(connection pooler?) — fix before serving traffic.`
    );
  }
  logger.info(got, 'Fast-pool DB timeouts verified');
}

// Re-export PrismaClient class and Prisma namespace for use by other services
// The PrismaClient is exported as both a value (class) and type
export { PrismaClient, Prisma } from '../generated/prisma/client.js';

// Explicitly re-export Null types from runtime library to fix TypeScript type inference
// issues with pnpm workspaces (TS2742 errors about non-portable type references)
