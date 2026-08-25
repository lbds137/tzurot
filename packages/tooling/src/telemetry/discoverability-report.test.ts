import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import type { PerCommandRawRow, BreadthRawRow, HeaderRawRow } from './discoverability-report.js';

const mockDispose = vi.fn().mockResolvedValue(undefined);

vi.mock('@tzurot/common-types/services/poolConfig', () => ({
  DB_POOL_DEFAULTS: { TRANSIENT_MAX: 5 },
}));
vi.mock('@tzurot/common-types/services/prisma', () => ({
  createPrismaClient: vi.fn(),
}));
vi.mock('chalk', () => ({
  default: {
    bold: (s: string) => s,
    dim: (s: string) => s,
    red: (s: string) => s,
    yellow: (s: string) => s,
    green: (s: string) => s,
  },
}));

const envRunnerMock = {
  validateEnvironment: vi.fn(),
  showEnvironmentBanner: vi.fn(),
  getRailwayDatabaseUrl: vi.fn().mockReturnValue('postgres://railway'),
};
vi.mock('../utils/env-runner.js', () => envRunnerMock);

vi.mock('node:fs', () => ({
  writeFileSync: vi.fn(),
}));

describe('discoverability-report', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let mockQueryRaw: ReturnType<typeof vi.fn>;

  const emptyHeader: HeaderRawRow[] = [
    { total_events: 0n, distinct_users: 0n, distinct_commands: 0n },
  ];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.exitCode = undefined;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockQueryRaw = vi.fn();
    vi.mocked(createPrismaClient).mockReturnValue({
      prisma: { $queryRaw: mockQueryRaw },
      dispose: mockDispose,
    } as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.useRealTimers();
  });

  describe('parseDays', () => {
    it('defaults to 30 when undefined', async () => {
      const { parseDays } = await import('./discoverability-report.js');
      expect(parseDays(undefined)).toBe(30);
    });

    it('accepts a valid positive integer string', async () => {
      const { parseDays } = await import('./discoverability-report.js');
      expect(parseDays('7')).toBe(7);
    });

    it('accepts a valid positive integer number', async () => {
      const { parseDays } = await import('./discoverability-report.js');
      expect(parseDays(14)).toBe(14);
    });

    it.each([0, -1, 2.5, 'abc'])('rejects invalid --days value %p', async input => {
      const { parseDays } = await import('./discoverability-report.js');
      expect(() => parseDays(input as never)).toThrow();
    });
  });

  describe('bucketBreadth', () => {
    it('buckets every boundary correctly', async () => {
      const { bucketBreadth } = await import('./discoverability-report.js');
      const rows = [
        { breadth: 1, userCount: 10 },
        { breadth: 2, userCount: 5 },
        { breadth: 3, userCount: 3 },
        { breadth: 4, userCount: 2 },
        { breadth: 6, userCount: 1 },
        { breadth: 7, userCount: 4 },
        { breadth: 12, userCount: 1 },
      ];
      const buckets = bucketBreadth(rows);
      expect(buckets).toEqual([
        { label: '1', userCount: 10 },
        { label: '2–3', userCount: 8 },
        { label: '4–6', userCount: 3 },
        { label: '7+', userCount: 5 },
      ]);
    });

    it('returns all four buckets with zero counts when no rows', async () => {
      const { bucketBreadth } = await import('./discoverability-report.js');
      expect(bucketBreadth([])).toEqual([
        { label: '1', userCount: 0 },
        { label: '2–3', userCount: 0 },
        { label: '4–6', userCount: 0 },
        { label: '7+', userCount: 0 },
      ]);
    });
  });

  describe('isUserErrorFlagged', () => {
    it('flags a row at/above both thresholds', async () => {
      const { isUserErrorFlagged } = await import('./discoverability-report.js');
      expect(isUserErrorFlagged(5, 1)).toBe(true); // 1/5 = 0.2, invocations = 5
      expect(isUserErrorFlagged(10, 5)).toBe(true); // 0.5 ratio, 10 invocations
    });

    it('does not flag above the ratio but below the invocation floor', async () => {
      const { isUserErrorFlagged } = await import('./discoverability-report.js');
      expect(isUserErrorFlagged(4, 4)).toBe(false); // ratio 1.0 but only 4 invocations
    });

    it('does not flag above the floor but below the ratio', async () => {
      const { isUserErrorFlagged } = await import('./discoverability-report.js');
      expect(isUserErrorFlagged(10, 1)).toBe(false); // ratio 0.1, invocations 10
    });
  });

  describe('renderDiscoverabilityMarkdown + telemetryReport (bigint, privacy, dark features, other)', () => {
    it('converts bigint counts to plain numbers in the rendered table', async () => {
      const perCommand: PerCommandRawRow[] = [
        {
          command: 'character.create',
          invocations: 5n,
          distinct_users: 3n,
          ok_count: 4n,
          user_error_count: 1n,
          system_error_count: 0n,
        },
      ];
      mockQueryRaw
        .mockResolvedValueOnce(perCommand)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(emptyHeader);

      const { telemetryReport } = await import('./discoverability-report.js');
      await telemetryReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('| character.create ⚠️ | 5 | 3 | 4 | 1 | 0 | 0 | 20.0% |');
      expect(output).not.toContain('5n');
      expect(output).not.toContain('[object');
    });

    it('lists dark features with distinct_users <= 1', async () => {
      const perCommand: PerCommandRawRow[] = [
        {
          command: 'memory.browse',
          invocations: 2n,
          distinct_users: 1n,
          ok_count: 2n,
          user_error_count: 0n,
          system_error_count: 0n,
        },
      ];
      mockQueryRaw
        .mockResolvedValueOnce(perCommand)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(emptyHeader);

      const { telemetryReport } = await import('./discoverability-report.js');
      await telemetryReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('## Dark features');
      expect(output).toContain('`memory.browse` — 2 invocation(s), single distinct user');
    });

    it('prints "None in this window." when there are no dark features', async () => {
      const perCommand: PerCommandRawRow[] = [
        {
          command: 'memory.browse',
          invocations: 10n,
          distinct_users: 5n,
          ok_count: 10n,
          user_error_count: 0n,
          system_error_count: 0n,
        },
      ];
      mockQueryRaw
        .mockResolvedValueOnce(perCommand)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(emptyHeader);

      const { telemetryReport } = await import('./discoverability-report.js');
      await telemetryReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('None in this window.');
    });

    it('flags a row exceeding both thresholds with the warning marker', async () => {
      const perCommand: PerCommandRawRow[] = [
        {
          command: 'shapes.import',
          invocations: 10n,
          distinct_users: 4n,
          ok_count: 5n,
          user_error_count: 5n,
          system_error_count: 0n,
        },
      ];
      mockQueryRaw
        .mockResolvedValueOnce(perCommand)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(emptyHeader);

      const { telemetryReport } = await import('./discoverability-report.js');
      await telemetryReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('| shapes.import ⚠️ |');
    });

    it('derives a nonzero other count when invocations exceed ok+user_error+system_error', async () => {
      const perCommand: PerCommandRawRow[] = [
        {
          command: 'voice.speak',
          invocations: 10n,
          distinct_users: 4n,
          ok_count: 5n,
          user_error_count: 1n,
          system_error_count: 1n,
        },
      ];
      mockQueryRaw
        .mockResolvedValueOnce(perCommand)
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(emptyHeader);

      const { telemetryReport } = await import('./discoverability-report.js');
      await telemetryReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      // 10 - 5 - 1 - 1 = 3 "other"
      expect(output).toContain('| voice.speak | 10 | 4 | 5 | 1 | 1 | 3 | 10.0% |');
    });

    it('never prints a raw user id even when one rides along on a row', async () => {
      const SENSITIVE_USER_ID = '111222333444555666';
      // The breadth query's inner subquery groups BY user_id, so a widened
      // outer SELECT (or a renderer that dumps whole rows) would carry the id
      // into the report. Feeding it here is what gives the assertion below
      // something it can actually fail on.
      const breadthRowCarryingUserId = {
        breadth: 2n,
        user_count: 1n,
        user_id: SENSITIVE_USER_ID,
      };
      const breadth: BreadthRawRow[] = [breadthRowCarryingUserId];
      const perCommand: PerCommandRawRow[] = [
        {
          command: 'memory.browse',
          invocations: 3n,
          distinct_users: 1n,
          ok_count: 3n,
          user_error_count: 0n,
          system_error_count: 0n,
        },
      ];
      mockQueryRaw
        .mockResolvedValueOnce(perCommand)
        .mockResolvedValueOnce(breadth)
        .mockResolvedValueOnce(emptyHeader);

      const { telemetryReport } = await import('./discoverability-report.js');
      await telemetryReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).not.toContain(SENSITIVE_USER_ID);
      // The bucket the id rode in on still renders, so the assertion above is
      // passing because the id was dropped rather than because the row was.
      expect(output).toContain('| 2–3 | 1 |');
    });

    it('renders the header line and summary counts from the header query', async () => {
      const header: HeaderRawRow[] = [
        { total_events: 12n, distinct_users: 4n, distinct_commands: 3n },
      ];
      mockQueryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(header);

      const { telemetryReport } = await import('./discoverability-report.js');
      await telemetryReport({ env: 'local', days: 14 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain(
        'Window: trailing 14 days · env: local · generated at 2026-08-25T12:00:00.000Z'
      );
      expect(output).toContain('- Total invocations: 12');
      expect(output).toContain('- Distinct users: 4');
      expect(output).toContain('- Distinct commands: 3');
    });
  });

  describe('--days validation', () => {
    it.each([0, -1, 2.5, 'abc'])('rejects %p and does not construct a DB client', async invalid => {
      const { telemetryReport } = await import('./discoverability-report.js');
      await telemetryReport({ env: 'local', days: invalid as never });

      expect(createPrismaClient).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });

    it('binds the parsed value into every query rather than a hardcoded window', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(emptyHeader);
      const { telemetryReport } = await import('./discoverability-report.js');
      await telemetryReport({ env: 'local', days: '7' });

      expect(createPrismaClient).toHaveBeenCalled();
      expect(mockQueryRaw).toHaveBeenCalledTimes(3);
      // Tagged template: call[0] is the strings array, call[1] the first bind.
      // Asserting the VALUE (not just that a call happened) is what catches a
      // window silently pinned to the default.
      for (const call of mockQueryRaw.mock.calls) {
        expect(call[1]).toBe(7);
      }
    });
  });

  describe('--output', () => {
    it('writes the file and prints a note when --output is set', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(emptyHeader);
      const { telemetryReport } = await import('./discoverability-report.js');
      await telemetryReport({ env: 'local', days: 30, output: '/tmp/report.md' });

      expect(writeFileSync).toHaveBeenCalledWith('/tmp/report.md', expect.any(String), 'utf-8');
      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('/tmp/report.md');
    });

    it('prints the markdown to stdout when --output is not set', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(emptyHeader);
      const { telemetryReport } = await import('./discoverability-report.js');
      await telemetryReport({ env: 'local', days: 30 });

      expect(writeFileSync).not.toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('# Command discoverability report');
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('dispose()', () => {
    it('is called in the finally path on success', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(emptyHeader);
      const { telemetryReport } = await import('./discoverability-report.js');
      await telemetryReport({ env: 'local', days: 30 });

      expect(mockDispose).toHaveBeenCalled();
    });

    it('is called in the finally path when a query throws', async () => {
      mockQueryRaw.mockRejectedValueOnce(new Error('db exploded'));
      const { telemetryReport } = await import('./discoverability-report.js');

      await expect(telemetryReport({ env: 'local', days: 30 })).rejects.toThrow('db exploded');
      expect(mockDispose).toHaveBeenCalled();
    });
  });
});
