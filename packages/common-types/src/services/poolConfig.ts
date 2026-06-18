/**
 * Database connection-pool configuration + saturation gauge.
 *
 * The Prisma 7 driver adapter (`@prisma/adapter-pg`) was constructed with no
 * pool options, so the underlying node-postgres pool used its defaults:
 * `max = 10` and `connectionTimeoutMillis = 0` (wait FOREVER for a free
 * connection). Under concurrent load that silently queues requests on
 * connection acquisition — before any query runs or any line is logged —
 * surfacing as cross-endpoint timeouts whose handlers "log nothing".
 *
 * These helpers make the pool explicit and bounded (env-tunable) and surface
 * saturation, so the failure mode is loud and measurable instead of silent.
 * The driver adapter ignores the `?connection_limit=` URL param, so the pool
 * size MUST be set here, not on `DATABASE_URL`.
 */

/** Pool defaults. Overridable via env so prod can be tuned without a redeploy. */
export const DB_POOL_DEFAULTS = {
  /** Max physical connections per service process (was the pg.Pool default of 10). */
  MAX: 20,
  /** Acquisition timeout. Finite, so a saturated pool fails loudly instead of
   *  hanging forever; generous enough to ride out a brief burst. 0 = wait forever. */
  CONNECTION_TIMEOUT_MS: 10_000,
  /** Saturation-gauge interval. Logs WARN only when connections are queued, so
   *  the next incident is captured automatically. 0 disables the gauge. */
  STATS_INTERVAL_MS: 30_000,
  /** Max for transient/short-lived clients (CLI scripts, cross-env sync) — small
   *  on purpose; these aren't the long-running request pool. */
  TRANSIENT_MAX: 5,
} as const;

/** Parse a non-negative integer env var, falling back when unset/invalid. */
function parseIntEnv(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

/** Resolve the pool `max` (must be ≥ 1). */
export function resolvePoolMax(env: NodeJS.ProcessEnv = process.env): number {
  return parseIntEnv(env.DATABASE_POOL_MAX, DB_POOL_DEFAULTS.MAX, 1);
}

/** Resolve the connection-acquisition timeout in ms (0 = wait forever). */
export function resolveConnectionTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseIntEnv(env.DATABASE_POOL_CONN_TIMEOUT_MS, DB_POOL_DEFAULTS.CONNECTION_TIMEOUT_MS, 0);
}

/** Resolve the saturation-gauge interval in ms (0 = disabled). */
export function resolvePoolStatsIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseIntEnv(env.DATABASE_POOL_STATS_INTERVAL_MS, DB_POOL_DEFAULTS.STATS_INTERVAL_MS, 0);
}

/**
 * Pool options for transient/short-lived `PrismaPg` clients (CLI scripts,
 * cross-env sync) that don't warrant the full singleton pool: a small `max` plus
 * the same finite acquisition timeout, so they fail loudly instead of hanging
 * forever on a saturated/unreachable database. Spread into a `PrismaPg` config:
 * `new PrismaPg({ connectionString, ...transientPoolOptions() })`.
 */
export function transientPoolOptions(env: NodeJS.ProcessEnv = process.env): {
  max: number;
  connectionTimeoutMillis: number;
} {
  return {
    max: DB_POOL_DEFAULTS.TRANSIENT_MAX,
    connectionTimeoutMillis: resolveConnectionTimeoutMs(env),
  };
}

/** The pool stats the gauge reads (subset of `pg.Pool`). */
export interface PoolStatsSource {
  readonly totalCount: number;
  readonly idleCount: number;
  readonly waitingCount: number;
}

/** Minimal logger surface the gauge needs (keeps this module test-friendly). */
export interface GaugeLogger {
  warn: (obj: object, msg: string) => void;
  debug: (obj: object, msg: string) => void;
}

/**
 * Start a periodic pool-saturation gauge. Logs at WARN when requests are queued
 * for a connection (`waitingCount > 0` — the smoking-gun signal for pool
 * starvation) and at debug otherwise. Returns a stop function. When
 * `intervalMs <= 0` the gauge is disabled and the returned stop is a no-op.
 *
 * The interval is `unref`'d so it never holds the process open. This is
 * observability, not a cleanup task — it does not belong on a BullMQ schedule.
 */
export function startPoolStatsGauge(
  pool: PoolStatsSource,
  logger: GaugeLogger,
  intervalMs: number,
  poolMax: number
): () => void {
  if (intervalMs <= 0) {
    return () => undefined;
  }
  const timer = setInterval(() => {
    const stats = {
      poolMax,
      total: pool.totalCount,
      idle: pool.idleCount,
      waiting: pool.waitingCount,
    };
    if (pool.waitingCount > 0) {
      logger.warn(stats, 'pg.Pool saturated — requests waiting for a DB connection');
    } else {
      logger.debug(stats, 'pg.Pool stats');
    }
  }, intervalMs);
  timer.unref();
  return () => {
    clearInterval(timer);
  };
}
