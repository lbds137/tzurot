/**
 * Unit tests for createPrismaClient() — the post-singleton-eviction entry point.
 *
 * Mocks pg.Pool, the generated PrismaClient, the driver adapter, and poolConfig
 * so we can assert the lifecycle contract without a real database: pool sizing,
 * the dispose() order (stop the stats gauge BEFORE $disconnect so no stale
 * interval polls a closed pool), dispose() idempotency, and construction-failure
 * teardown (no leaked pool/interval if the client throws past gauge start).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockPool, mockPrisma, mockStopGauge, mockResolvePoolMax, mockStartGauge } = vi.hoisted(
  () => ({
    mockPool: { on: vi.fn(), end: vi.fn().mockResolvedValue(undefined) },
    mockPrisma: { $disconnect: vi.fn().mockResolvedValue(undefined) },
    mockStopGauge: vi.fn(),
    mockResolvePoolMax: vi.fn(() => 20),
    mockStartGauge: vi.fn(() => mockStopGauge),
  })
);

// `new Pool()` / `new PrismaClient()` need constructor-capable mocks — a `function`
// expression (not an arrow) so it's `new`-able and returns the mock instance.
vi.mock('pg', () => ({
  Pool: vi.fn(function () {
    return mockPool;
  }),
}));
vi.mock('../generated/prisma/client.js', () => ({
  PrismaClient: vi.fn(function () {
    return mockPrisma;
  }),
  Prisma: {},
}));
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: vi.fn() }));
vi.mock('../utils/logger.js', () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock('../config/config.js', () => ({ getConfig: () => ({ NODE_ENV: 'test' }) }));
vi.mock('./poolConfig.js', () => ({
  resolvePoolMax: mockResolvePoolMax,
  resolveConnectionTimeoutMs: vi.fn(() => 10_000),
  resolvePoolStatsIntervalMs: vi.fn(() => 0),
  // Mirror the real shape: keepAlive + explicit idle eviction + the lock_timeout GUC.
  mainPoolConnectionOptions: vi.fn(() => ({
    keepAlive: true,
    keepAliveInitialDelayMillis: 1000,
    idleTimeoutMillis: 10_000,
    options: '-c lock_timeout=3000',
  })),
  startPoolStatsGauge: mockStartGauge,
}));

import { Pool } from 'pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { createPrismaClient, verifyPoolTimeouts } from './prisma.js';

describe('createPrismaClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolvePoolMax.mockReturnValue(20);
    mockStartGauge.mockReturnValue(mockStopGauge);
  });

  it('sizes the pool from resolvePoolMax() by default', () => {
    createPrismaClient();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({ max: 20 }));
  });

  it('uses an explicit max override over resolvePoolMax()', () => {
    createPrismaClient({ max: 5 });
    expect(mockResolvePoolMax).not.toHaveBeenCalled();
    expect(Pool).toHaveBeenCalledWith(expect.objectContaining({ max: 5 }));
  });

  it('applies the main-pool hardening as the base config by default', () => {
    createPrismaClient();
    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        keepAlive: true,
        keepAliveInitialDelayMillis: 1000,
        idleTimeoutMillis: 10_000,
        options: '-c lock_timeout=3000',
      })
    );
  });

  it('spreads poolOverrides into the Pool config (fast-pool timeouts + GUC options)', () => {
    createPrismaClient({
      max: 5,
      poolOverrides: {
        query_timeout: 6000,
        keepAlive: true,
        options: '-c statement_timeout=5000 -c lock_timeout=2000',
      },
    });
    // The fast pool's own `options` string must fully REPLACE the main-pool base
    // one — spread order is the seam that keeps its tighter ladder authoritative.
    expect(Pool).toHaveBeenCalledWith(
      expect.objectContaining({
        max: 5,
        query_timeout: 6000,
        keepAlive: true,
        options: '-c statement_timeout=5000 -c lock_timeout=2000',
      })
    );
  });

  it('dispose() stops the stats gauge BEFORE disconnecting', async () => {
    const { dispose } = createPrismaClient();
    await dispose();

    expect(mockStopGauge).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$disconnect).toHaveBeenCalledTimes(1);
    // Order matters: a gauge polling a $disconnect-ed pool would throw.
    expect(mockStopGauge.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.$disconnect.mock.invocationCallOrder[0]
    );
  });

  it('dispose() is idempotent — a double call disconnects only once', async () => {
    const { dispose } = createPrismaClient();
    await dispose();
    await dispose();

    expect(mockPrisma.$disconnect).toHaveBeenCalledTimes(1);
    expect(mockStopGauge).toHaveBeenCalledTimes(1);
  });

  it('tears down the pool + gauge and rethrows if PrismaClient construction throws', () => {
    vi.mocked(PrismaClient).mockImplementationOnce(function () {
      throw new Error('client construction failed');
    });

    expect(() => createPrismaClient()).toThrow('client construction failed');
    // No leaked interval or pool connections — both torn down before rethrow.
    expect(mockStopGauge).toHaveBeenCalledTimes(1);
    expect(mockPool.end).toHaveBeenCalledTimes(1);
  });
});

describe('verifyPoolTimeouts', () => {
  // pg_settings.setting reports timeouts in ms; the probe does a direct int match.
  const fakePrisma = (rows: { name: string; setting: string }[]): PrismaClient =>
    ({ $queryRaw: vi.fn().mockResolvedValue(rows) }) as unknown as PrismaClient;

  it('resolves when statement_timeout + lock_timeout match the expected ms', async () => {
    await expect(
      verifyPoolTimeouts(
        fakePrisma([
          { name: 'statement_timeout', setting: '5000' },
          { name: 'lock_timeout', setting: '2000' },
        ]),
        { statementTimeoutMs: 5000, lockTimeoutMs: 2000 }
      )
    ).resolves.toBeUndefined();
  });

  it('throws when a GUC did not apply (options stripped → defaults to 0)', async () => {
    await expect(
      verifyPoolTimeouts(
        fakePrisma([
          { name: 'statement_timeout', setting: '0' },
          { name: 'lock_timeout', setting: '0' },
        ]),
        { statementTimeoutMs: 5000, lockTimeoutMs: 2000 }
      )
    ).rejects.toThrow(/did not apply/);
  });
});
