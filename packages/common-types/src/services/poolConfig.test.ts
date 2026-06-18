/**
 * Tests for database pool configuration + saturation gauge.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DB_POOL_DEFAULTS,
  resolvePoolMax,
  resolveConnectionTimeoutMs,
  resolvePoolStatsIntervalMs,
  startPoolStatsGauge,
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

  it('reads a valid override and falls back on garbage', () => {
    expect(resolveConnectionTimeoutMs({ DATABASE_POOL_CONN_TIMEOUT_MS: '3000' })).toBe(3000);
    expect(resolveConnectionTimeoutMs({ DATABASE_POOL_CONN_TIMEOUT_MS: 'soon' })).toBe(
      DB_POOL_DEFAULTS.CONNECTION_TIMEOUT_MS
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
