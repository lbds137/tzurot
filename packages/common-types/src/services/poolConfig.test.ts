/**
 * Tests for database pool configuration + saturation gauge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DB_POOL_DEFAULTS,
  FAST_POOL_DEFAULTS,
  MAIN_POOL_DEFAULTS,
  resolvePoolMax,
  resolveConnectionTimeoutMs,
  resolvePoolStatsIntervalMs,
  resolveMainLockTimeoutMs,
  resolveMainIdleInTxTimeoutMs,
  mainPoolConnectionOptions,
  resolveFastPoolMax,
  resolveFastLockTimeoutMs,
  resolveFastStatementTimeoutMs,
  resolveFastQueryTimeoutMs,
  fastPoolConnectionOptions,
  startPoolStatsGauge,
  transientPoolOptions,
  type PoolStatsSource,
} from './poolConfig.js';

describe('resolvePoolMax', () => {
  it('defaults when unset', () => {
    expect(resolvePoolMax({})).toBe(DB_POOL_DEFAULTS.MAX);
  });

  it('reads a valid override', () => {
    expect(resolvePoolMax({ DATABASE_POOL_MAX: '40' })).toBe(40);
  });

  it('falls back on a non-numeric or sub-minimum value (must be ≥ 1)', () => {
    expect(resolvePoolMax({ DATABASE_POOL_MAX: 'lots' })).toBe(DB_POOL_DEFAULTS.MAX);
    expect(resolvePoolMax({ DATABASE_POOL_MAX: '0' })).toBe(DB_POOL_DEFAULTS.MAX);
    expect(resolvePoolMax({ DATABASE_POOL_MAX: '-5' })).toBe(DB_POOL_DEFAULTS.MAX);
  });
});

describe('resolveConnectionTimeoutMs', () => {
  it('defaults when unset', () => {
    expect(resolveConnectionTimeoutMs({})).toBe(DB_POOL_DEFAULTS.CONNECTION_TIMEOUT_MS);
  });

  it('allows 0 (wait forever) as an explicit opt-out', () => {
    expect(resolveConnectionTimeoutMs({ DATABASE_POOL_CONN_TIMEOUT_MS: '0' })).toBe(0);
  });

  it('reads a valid override and falls back on garbage or negative values', () => {
    expect(resolveConnectionTimeoutMs({ DATABASE_POOL_CONN_TIMEOUT_MS: '3000' })).toBe(3000);
    expect(resolveConnectionTimeoutMs({ DATABASE_POOL_CONN_TIMEOUT_MS: 'soon' })).toBe(
      DB_POOL_DEFAULTS.CONNECTION_TIMEOUT_MS
    );
    expect(resolveConnectionTimeoutMs({ DATABASE_POOL_CONN_TIMEOUT_MS: '-1' })).toBe(
      DB_POOL_DEFAULTS.CONNECTION_TIMEOUT_MS
    );
  });
});

describe('transientPoolOptions', () => {
  it('uses the small transient max and the resolved (finite) acquisition timeout', () => {
    expect(transientPoolOptions({})).toEqual({
      max: DB_POOL_DEFAULTS.TRANSIENT_MAX,
      connectionTimeoutMillis: DB_POOL_DEFAULTS.CONNECTION_TIMEOUT_MS,
    });
  });

  it('honors a DATABASE_POOL_CONN_TIMEOUT_MS override for the timeout', () => {
    expect(transientPoolOptions({ DATABASE_POOL_CONN_TIMEOUT_MS: '2000' })).toEqual({
      max: DB_POOL_DEFAULTS.TRANSIENT_MAX,
      connectionTimeoutMillis: 2000,
    });
  });
});

describe('mainPoolConnectionOptions', () => {
  it('builds keepAlive + explicit idle eviction + the GUC pair with defaults', () => {
    expect(mainPoolConnectionOptions({})).toEqual({
      keepAlive: true,
      keepAliveInitialDelayMillis: MAIN_POOL_DEFAULTS.KEEPALIVE_INITIAL_DELAY_MS,
      idleTimeoutMillis: MAIN_POOL_DEFAULTS.IDLE_TIMEOUT_MS,
      options:
        `-c lock_timeout=${MAIN_POOL_DEFAULTS.LOCK_TIMEOUT_MS} ` +
        `-c idle_in_transaction_session_timeout=${MAIN_POOL_DEFAULTS.IDLE_IN_TX_TIMEOUT_MS}`,
    });
  });

  it('deliberately sets NO statement_timeout (legit long ops stay exempt)', () => {
    // The main pool serves pgvector search / Shapes import / retention batches;
    // a pool-wide statement ceiling would clip them — that exemption is the
    // reason the fast pool exists as a separate pool.
    expect(mainPoolConnectionOptions({}).options).not.toContain('statement_timeout');
  });

  it('honors a DB_MAIN_LOCK_TIMEOUT_MS override and falls back on garbage', () => {
    expect(mainPoolConnectionOptions({ DB_MAIN_LOCK_TIMEOUT_MS: '5000' }).options).toContain(
      '-c lock_timeout=5000'
    );
    expect(resolveMainLockTimeoutMs({ DB_MAIN_LOCK_TIMEOUT_MS: 'nope' })).toBe(
      MAIN_POOL_DEFAULTS.LOCK_TIMEOUT_MS
    );
    expect(resolveMainLockTimeoutMs({ DB_MAIN_LOCK_TIMEOUT_MS: '0' })).toBe(
      MAIN_POOL_DEFAULTS.LOCK_TIMEOUT_MS
    );
  });

  it('reaps wedged transactions: idle_in_transaction GUC rides the startup options', () => {
    expect(mainPoolConnectionOptions({ DB_MAIN_IDLE_IN_TX_TIMEOUT_MS: '30000' }).options).toContain(
      '-c idle_in_transaction_session_timeout=30000'
    );
    expect(resolveMainIdleInTxTimeoutMs({})).toBe(MAIN_POOL_DEFAULTS.IDLE_IN_TX_TIMEOUT_MS);
    expect(resolveMainIdleInTxTimeoutMs({ DB_MAIN_IDLE_IN_TX_TIMEOUT_MS: 'nope' })).toBe(
      MAIN_POOL_DEFAULTS.IDLE_IN_TX_TIMEOUT_MS
    );
  });

  it('0 disables the idle-in-transaction reaper (GUC omitted, lock_timeout intact)', () => {
    const options = mainPoolConnectionOptions({ DB_MAIN_IDLE_IN_TX_TIMEOUT_MS: '0' }).options;
    expect(options).not.toContain('idle_in_transaction_session_timeout');
    expect(options).toBe(`-c lock_timeout=${MAIN_POOL_DEFAULTS.LOCK_TIMEOUT_MS}`);
  });
});

describe('fast-pool resolvers', () => {
  it('default to FAST_POOL_DEFAULTS when unset', () => {
    expect(resolveFastPoolMax({})).toBe(FAST_POOL_DEFAULTS.MAX);
    expect(resolveFastLockTimeoutMs({})).toBe(FAST_POOL_DEFAULTS.LOCK_TIMEOUT_MS);
    expect(resolveFastStatementTimeoutMs({})).toBe(FAST_POOL_DEFAULTS.STATEMENT_TIMEOUT_MS);
    expect(resolveFastQueryTimeoutMs({})).toBe(FAST_POOL_DEFAULTS.QUERY_TIMEOUT_MS);
  });

  it('read valid overrides and fall back on garbage / sub-minimum', () => {
    expect(resolveFastLockTimeoutMs({ DB_FAST_LOCK_TIMEOUT_MS: '1500' })).toBe(1500);
    expect(resolveFastStatementTimeoutMs({ DB_FAST_STATEMENT_TIMEOUT_MS: '0' })).toBe(
      FAST_POOL_DEFAULTS.STATEMENT_TIMEOUT_MS
    );
    expect(resolveFastQueryTimeoutMs({ DB_FAST_QUERY_TIMEOUT_MS: 'nope' })).toBe(
      FAST_POOL_DEFAULTS.QUERY_TIMEOUT_MS
    );
  });
});

describe('fastPoolConnectionOptions', () => {
  it('builds the staggered ladder + GUC options string with defaults', () => {
    const cfg = fastPoolConnectionOptions({});
    expect(cfg.statementTimeoutMs).toBe(FAST_POOL_DEFAULTS.STATEMENT_TIMEOUT_MS);
    expect(cfg.lockTimeoutMs).toBe(FAST_POOL_DEFAULTS.LOCK_TIMEOUT_MS);
    // Ladder invariant: lock < statement < query so exactly one fires first.
    expect(cfg.lockTimeoutMs).toBeLessThan(cfg.statementTimeoutMs);
    expect(cfg.statementTimeoutMs).toBeLessThan(cfg.poolOverrides.query_timeout);
    expect(cfg.max).toBe(FAST_POOL_DEFAULTS.MAX);
    expect(cfg.poolOverrides).toMatchObject({
      connectionTimeoutMillis: FAST_POOL_DEFAULTS.CONNECTION_TIMEOUT_MS,
      query_timeout: FAST_POOL_DEFAULTS.QUERY_TIMEOUT_MS,
      idleTimeoutMillis: FAST_POOL_DEFAULTS.IDLE_TIMEOUT_MS,
      keepAlive: true,
      keepAliveInitialDelayMillis: FAST_POOL_DEFAULTS.KEEPALIVE_INITIAL_DELAY_MS,
    });
    expect(cfg.poolOverrides.options).toBe(
      `-c statement_timeout=${FAST_POOL_DEFAULTS.STATEMENT_TIMEOUT_MS} ` +
        `-c lock_timeout=${FAST_POOL_DEFAULTS.LOCK_TIMEOUT_MS} ` +
        `-c idle_in_transaction_session_timeout=${FAST_POOL_DEFAULTS.IDLE_IN_TX_TIMEOUT_MS}`
    );
    // Must NEVER set the superuser-only log_lock_waits — would break non-superuser connections.
    expect(cfg.poolOverrides.options).not.toContain('log_lock_waits');
  });

  it('honors env overrides in the options string', () => {
    // Keep the ladder valid (lock < statement < query) — bump query above statement.
    const cfg = fastPoolConnectionOptions({
      DB_FAST_STATEMENT_TIMEOUT_MS: '8000',
      DB_FAST_LOCK_TIMEOUT_MS: '3000',
      DB_FAST_QUERY_TIMEOUT_MS: '9000',
    });
    expect(cfg.poolOverrides.options).toContain('-c statement_timeout=8000');
    expect(cfg.poolOverrides.options).toContain('-c lock_timeout=3000');
    expect(cfg.poolOverrides.query_timeout).toBe(9000);
  });

  it('throws when an env override inverts the lock < statement < query ladder', () => {
    // lock >= statement
    expect(() =>
      fastPoolConnectionOptions({
        DB_FAST_LOCK_TIMEOUT_MS: '9000',
        DB_FAST_STATEMENT_TIMEOUT_MS: '3000',
      })
    ).toThrow(/ladder violated/);
    // statement >= query_timeout (default query is 3000)
    expect(() => fastPoolConnectionOptions({ DB_FAST_STATEMENT_TIMEOUT_MS: '9000' })).toThrow(
      /ladder violated/
    );
  });
});

describe('resolvePoolStatsIntervalMs', () => {
  it('defaults when unset and treats 0 as disabled', () => {
    expect(resolvePoolStatsIntervalMs({})).toBe(DB_POOL_DEFAULTS.STATS_INTERVAL_MS);
    expect(resolvePoolStatsIntervalMs({ DATABASE_POOL_STATS_INTERVAL_MS: '0' })).toBe(0);
  });

  it('reads a valid override', () => {
    expect(resolvePoolStatsIntervalMs({ DATABASE_POOL_STATS_INTERVAL_MS: '15000' })).toBe(15000);
  });
});

describe('startPoolStatsGauge', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  function makeLogger() {
    return {
      warn: vi.fn<(obj: object, msg: string) => void>(),
      debug: vi.fn<(obj: object, msg: string) => void>(),
    };
  }

  it('is a no-op (never logs) when the interval is disabled', () => {
    const logger = makeLogger();
    const pool: PoolStatsSource = { totalCount: 5, idleCount: 0, waitingCount: 3 };
    const stop = startPoolStatsGauge(pool, logger, 0, 20);

    vi.advanceTimersByTime(60_000);

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });

  it('warns when connections are queued and debug-logs when not', () => {
    const logger = makeLogger();
    const pool = { totalCount: 20, idleCount: 0, waitingCount: 4 };
    const stop = startPoolStatsGauge(pool, logger, 1000, 20);

    vi.advanceTimersByTime(1000);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls[0][0]).toMatchObject({ poolMax: 20, waiting: 4, idle: 0 });
    expect(logger.debug).not.toHaveBeenCalled();

    // No more waiting → drops back to debug-level stats.
    pool.waitingCount = 0;
    vi.advanceTimersByTime(1000);
    expect(logger.debug).toHaveBeenCalledTimes(1);

    stop();
    vi.advanceTimersByTime(5000);
    expect(logger.warn).toHaveBeenCalledTimes(1); // stopped — no further logs
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });
});
