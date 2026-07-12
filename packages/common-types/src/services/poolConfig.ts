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
  /** Server GUC. Single-row INSERT acquires locks in low-ms; 1s absorbs normal
   *  contention and fires FIRST → labels a lock wait (SQLSTATE 55P03). */
  LOCK_TIMEOUT_MS: 1_000,
  /** Server GUC. Healthy INSERT <100ms; even a GIN flush should be <1s. 2s
   *  catches pathological slow work → labels it (SQLSTATE 57014). */
  STATEMENT_TIMEOUT_MS: 2_000,
  /** Server GUC. A leaked transaction can't pin a fast-pool connection. */
  IDLE_IN_TX_TIMEOUT_MS: 5_000,
  /** Client-side (node-postgres) abort — the backstop for a dead/stale socket
   *  the server never sees (so the GUCs can't fire). 1s above statement_timeout
   *  so the server cancels first when it IS reachable. When it fires, the dead
   *  connection is destroyed (pg-pool `_release` removes on error) and the
   *  persist route retries once on a fresh socket. Kept small (3s) so that
   *  retry — the actual recovery — happens fast. */
  QUERY_TIMEOUT_MS: 3_000,
  /** Evict idle fast-pool connections before a middlebox silently reaps the
   *  socket, so a stale connection is never handed out. Deliberately SHORTER
   *  than pg-pool's built-in 10s default so eviction is more aggressive, not
   *  less (a longer value would just give the reaper more time). The reconnect
   *  cost is trivial on this small, low-volume pool. Defense-in-depth: can't be
   *  tuned against an unknown reaper threshold, so the retry is the actual fix
   *  and this just reduces how often the retry path is hit. */
  IDLE_TIMEOUT_MS: 5_000,
  /** TCP keepalive first-probe delay; proactive dead-socket detection. Low so
   *  probing starts early — though the OS keepalive INTERVAL (~75s, not settable
   *  via pg.Pool) means keepalive alone can't beat an aggressive reaper; the
   *  retry is what actually recovers. */
  KEEPALIVE_INITIAL_DELAY_MS: 1_000,
} as const;

/**
 * Main-pool hardening defaults. The fast pool (persist writes) got the full
 * timeout ladder + keepAlive + retry in its own incident cycle; the MAIN pool —
 * every other query in every service — had none of it, so its failures were
 * silent: a query on a network-reaped socket hangs to the caller's HTTP abort,
 * and a lock wait has no ceiling. Observed shape: a personality routing-load
 * took ~20s (a fresh-connection TCP stall after an idle-quiet period), which
 * bot-client's ~3s abort turned into a silently dropped @mention.
 *
 * Deliberately NO `statement_timeout` here: the main pool serves legitimately
 * long operations (pgvector search, Shapes import/export, retention batches)
 * that a pool-wide ceiling would clip — that exemption-by-architecture is the
 * reason the fast pool exists as a separate pool at all. `lock_timeout` IS safe
 * pool-wide: a healthy op waits micro-to-milliseconds for locks; 3s of lock
 * waiting means contention that should fail loudly + self-label (SQLSTATE
 * 55P03) rather than stack up invisibly.
 */
export const MAIN_POOL_DEFAULTS = {
  /** Server GUC. Safe pool-wide: legit ops don't wait seconds on locks; a 55P03
   *  names the cause instead of an unbounded invisible queue. */
  LOCK_TIMEOUT_MS: 3_000,
  /** Server GUC. A wedged transaction (opened, then the app code hangs or leaks
   *  without commit/rollback) holds its row locks INDEFINITELY at the server
   *  (`idle_in_transaction_session_timeout=0` server-side), starving every
   *  writer that needs those rows — observed as an hour-plus prod lock storm
   *  where only the victims' lock_timeouts contained the damage. 60s is far
   *  beyond any legitimate idle-between-statements gap (Prisma's interactive
   *  transactions default to a ~5s client-side ceiling), so this only ever
   *  reaps genuinely wedged sessions. Transient clients (db-sync, CLI) carry
   *  no GUC string and are deliberately unaffected. */
  IDLE_IN_TX_TIMEOUT_MS: 60_000,
  /** Evict idle connections on our schedule (pg-pool's own default, made
   *  explicit) — paired with keepAlive so a retained idle socket is genuinely
   *  alive, not a middlebox-reaped husk waiting to hang the next query. */
  IDLE_TIMEOUT_MS: 10_000,
  /** TCP keepalive first-probe delay — the fast pool's proven value. */
  KEEPALIVE_INITIAL_DELAY_MS: 1_000,
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

/** Resolve the main-pool server-side `lock_timeout` in ms (≥ 1). */
export function resolveMainLockTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseIntEnv(env.DB_MAIN_LOCK_TIMEOUT_MS, MAIN_POOL_DEFAULTS.LOCK_TIMEOUT_MS, 1);
}

/**
 * Resolve the main-pool server-side `idle_in_transaction_session_timeout` in
 * ms. 0 = disabled (the GUC is omitted from the startup options) — the escape
 * hatch if the reaper ever bites a legitimate flow; tune via env, no redeploy.
 */
export function resolveMainIdleInTxTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  return parseIntEnv(
    env.DB_MAIN_IDLE_IN_TX_TIMEOUT_MS,
    MAIN_POOL_DEFAULTS.IDLE_IN_TX_TIMEOUT_MS,
    0
  );
}

/**
 * Main-pool hardening options, applied as the BASE pool config for every
 * `createPrismaClient` pool (fast-pool `poolOverrides` spread after this, so
 * its tighter ladder — including its own `options` string — fully wins there).
 *
 * Same pooler caveat as the fast pool: the `lock_timeout` GUC rides the
 * Postgres `options` startup string, which a fronting pooler (PgBouncer
 * txn-mode etc.) may strip. Unlike the fast pool there is NO boot-fail probe
 * here — losing the label reverts to the status quo (no ceiling), not to a
 * regression, so a stripped GUC is acceptable degradation.
 */
export function mainPoolConnectionOptions(env: NodeJS.ProcessEnv = process.env): {
  keepAlive: true;
  keepAliveInitialDelayMillis: number;
  idleTimeoutMillis: number;
  options: string;
} {
  const idleInTxMs = resolveMainIdleInTxTimeoutMs(env);
  const gucs = [`-c lock_timeout=${resolveMainLockTimeoutMs(env)}`];
  if (idleInTxMs > 0) {
    gucs.push(`-c idle_in_transaction_session_timeout=${idleInTxMs}`);
  }
  return {
    keepAlive: true,
    keepAliveInitialDelayMillis: MAIN_POOL_DEFAULTS.KEEPALIVE_INITIAL_DELAY_MS,
    idleTimeoutMillis: MAIN_POOL_DEFAULTS.IDLE_TIMEOUT_MS,
    options: gucs.join(' '),
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
    idleTimeoutMillis: number;
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
      idleTimeoutMillis: FAST_POOL_DEFAULTS.IDLE_TIMEOUT_MS,
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
