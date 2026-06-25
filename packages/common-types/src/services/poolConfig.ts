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

/**
 * Fast-pool defaults for the latency-sensitive Discord-event persist writes
 * (conversation user/assistant message). A SEPARATE small pool with tight,
 * STAGGERED finite timeouts so a stuck single-row write fails fast + LOUD
 * (instead of hanging silently to bot-client's ~20s write-call abort) AND
 * self-labels its cause. The main pool stays untouched, so legit long
 * operations (pgvector search, Shapes import/export, retention batch) are
 * exempt by architecture — no per-query exemption list to maintain.
 *
 * The ladder `lock < statement < query` makes the failure a diagnostic: whichever
 * fires first names the cause (lock wait → 55P03; slow server work / GIN
 * pending-list flush → 57014; dead/stale socket → client-side query_timeout).
 * All sit well under the ~20s HTTP write timeout so the gateway returns a real
 * error in ~6s worst case.
 */
export const FAST_POOL_DEFAULTS = {
  /** Small: persist writes are short and low-volume. */
  MAX: 5,
  /** Fail-fast on a saturated fast pool (vs the main pool's 10s). */
  CONNECTION_TIMEOUT_MS: 5_000,
  /** Server GUC. Single-row INSERT acquires locks in low-ms; 2s absorbs normal
   *  contention and fires FIRST → labels a lock wait (SQLSTATE 55P03). */
  LOCK_TIMEOUT_MS: 2_000,
  /** Server GUC. Healthy INSERT <100ms; even a GIN flush should be <1s. 5s
   *  catches pathological slow work → labels it (SQLSTATE 57014). */
  STATEMENT_TIMEOUT_MS: 5_000,
  /** Server GUC. A leaked transaction can't pin a fast-pool connection. */
  IDLE_IN_TX_TIMEOUT_MS: 5_000,
  /** Client-side (node-postgres) abort — the backstop for a dead/stale socket
   *  the server never sees (so the GUCs can't fire). 1s above statement_timeout
   *  so the server cancels first when it IS reachable. */
  QUERY_TIMEOUT_MS: 6_000,
  /** TCP keepalive first-probe delay; proactive dead-socket detection. */
  KEEPALIVE_INITIAL_DELAY_MS: 10_000,
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

/** Resolve the fast-pool `max` (must be ≥ 1). */
export function resolveFastPoolMax(env: NodeJS.ProcessEnv = process.env): number {
  return parseIntEnv(env.DB_FAST_POOL_MAX, FAST_POOL_DEFAULTS.MAX, 1);
}

/** Resolve the fast-pool server-side `lock_timeout` in ms (≥ 1; must stay < statement). */
export function resolveFastLockTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseIntEnv(env.DB_FAST_LOCK_TIMEOUT_MS, FAST_POOL_DEFAULTS.LOCK_TIMEOUT_MS, 1);
}

/** Resolve the fast-pool server-side `statement_timeout` in ms (≥ 1; must stay < query_timeout). */
export function resolveFastStatementTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseIntEnv(env.DB_FAST_STATEMENT_TIMEOUT_MS, FAST_POOL_DEFAULTS.STATEMENT_TIMEOUT_MS, 1);
}

/** Resolve the fast-pool client-side `query_timeout` in ms (≥ 1; the dead-socket backstop). */
export function resolveFastQueryTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseIntEnv(env.DB_FAST_QUERY_TIMEOUT_MS, FAST_POOL_DEFAULTS.QUERY_TIMEOUT_MS, 1);
}

/** The fast-pool overrides handed to `createPrismaClient`, plus the resolved
 *  GUC values so the caller's boot probe can assert they actually applied. */
export interface FastPoolConfig {
  /** Fast-pool size — passed as `createPrismaClient`'s `max`. */
  max: number;
  /** Spread into the `pg.Pool` config (see `createPrismaClient`'s `poolOverrides`). */
  poolOverrides: {
    connectionTimeoutMillis: number;
    query_timeout: number;
    keepAlive: true;
    keepAliveInitialDelayMillis: number;
    /** Postgres startup `options` string — the ONLY reliable way to set the
     *  `statement_timeout`/`lock_timeout` GUCs through `@prisma/adapter-pg`
     *  (they are GUCs, not node-postgres ClientConfig fields). */
    options: string;
  };
  /** Resolved GUC ms values — fed to the boot `verifyPoolTimeouts` probe. */
  statementTimeoutMs: number;
  lockTimeoutMs: number;
}

/**
 * Build the fast-pool connection config. The server-side GUCs go in the
 * Postgres `options` startup string (applied to every connection at startup, so
 * they survive `@prisma/adapter-pg`'s internal connection checkout); the
 * client-side knobs (`query_timeout`, `keepAlive`) are native pg.Pool fields.
 *
 * NOTE: deliberately NO `log_lock_waits` here — it is a `superuser`-context GUC,
 * so setting it via `options` on a non-superuser app connection makes the
 * connection FAIL ("permission denied to set parameter"). Lock-holder
 * attribution is a separate (follow-up) concern; the 55P03 vs 57014 SQLSTATE
 * split already labels lock-vs-slow-work without it.
 */
export function fastPoolConnectionOptions(env: NodeJS.ProcessEnv = process.env): FastPoolConfig {
  const statementTimeoutMs = resolveFastStatementTimeoutMs(env);
  const lockTimeoutMs = resolveFastLockTimeoutMs(env);
  const queryTimeoutMs = resolveFastQueryTimeoutMs(env);
  const idleInTxMs = FAST_POOL_DEFAULTS.IDLE_IN_TX_TIMEOUT_MS;

  // The ladder lock < statement < query is load-bearing: it's what makes exactly
  // ONE timeout fire first, so the failure self-labels its cause. A bad env
  // override that inverts it would silently mislabel — fail fast at construction
  // instead (mirrors the verifyPoolTimeouts boot-probe stance).
  if (lockTimeoutMs >= statementTimeoutMs || statementTimeoutMs >= queryTimeoutMs) {
    throw new Error(
      `Fast-pool timeout ladder violated: lock(${lockTimeoutMs}) < statement(${statementTimeoutMs}) ` +
        `< query_timeout(${queryTimeoutMs}) must hold. Check DB_FAST_{LOCK,STATEMENT,QUERY}_TIMEOUT_MS.`
    );
  }

  return {
    max: resolveFastPoolMax(env),
    poolOverrides: {
      connectionTimeoutMillis: FAST_POOL_DEFAULTS.CONNECTION_TIMEOUT_MS,
      query_timeout: queryTimeoutMs,
      keepAlive: true,
      keepAliveInitialDelayMillis: FAST_POOL_DEFAULTS.KEEPALIVE_INITIAL_DELAY_MS,
      options:
        `-c statement_timeout=${statementTimeoutMs} ` +
        `-c lock_timeout=${lockTimeoutMs} ` +
        `-c idle_in_transaction_session_timeout=${idleInTxMs}`,
    },
    statementTimeoutMs,
    lockTimeoutMs,
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
