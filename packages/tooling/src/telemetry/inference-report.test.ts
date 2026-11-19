import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import type {
  PerModelRawRow,
  CacheHitRawRow,
  FreeTierRawRow,
  PersonalityRawRow,
} from './inference-report.js';

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

describe('inference-report', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let mockQueryRaw: ReturnType<typeof vi.fn>;

  // queryReportData issues its four queries in this fixed order:
  // 1. per-provider/model, 2. cache hit rate, 3. free-tier spend proxy, 4. per-personality attribution.
  const emptyPerModel: PerModelRawRow[] = [];
  const emptyCache: CacheHitRawRow[] = [];
  const emptyFreeTier: FreeTierRawRow[] = [];
  const emptyPersonality: PersonalityRawRow[] = [];

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

  describe('--days validation', () => {
    it.each([0, -1, 2.5, 'abc'])('rejects %p and does not construct a DB client', async invalid => {
      const { telemetryInferenceReport } = await import('./inference-report.js');
      await telemetryInferenceReport({ env: 'local', days: invalid as never });

      expect(createPrismaClient).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('bind value', () => {
    it('binds the parsed value into every query rather than a hardcoded window', async () => {
      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
        .mockResolvedValueOnce(emptyCache)
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(emptyPersonality);
      const { telemetryInferenceReport } = await import('./inference-report.js');
      await telemetryInferenceReport({ env: 'local', days: '7' });

      expect(createPrismaClient).toHaveBeenCalled();
      expect(mockQueryRaw).toHaveBeenCalledTimes(4);
      // Tagged template: call[0] is the strings array, call[1] the first bind.
      // Asserting the VALUE (not just that a call happened) is what catches a
      // window silently pinned to the default on one of the four queries.
      for (const call of mockQueryRaw.mock.calls) {
        expect(call[1]).toBe(7);
      }
    });
  });

  describe('bigint conversion', () => {
    const rawRow: PerModelRawRow = {
      provider: 'openrouter',
      model: 'glm-4.6',
      requests: 12n,
      tokens_in: 1000n,
      tokens_out: 500n,
      byok_true: 7n,
      byok_false: 3n,
      byok_null: 2n,
      latency_measured: 9n,
      latency_avg_ms: 250.5,
      latency_p95_ms: 900.25,
    };

    it('converts every bigint field to a plain JS number (typeof, not just string content)', async () => {
      // A bigint stringifies to the same digits as a number in a template
      // literal (`` `${12n}` `` === "12", no "n" suffix) — so a rendered-output
      // string match alone cannot distinguish a dropped Number() from a real
      // one. Assert typeof on the domain object directly.
      const { toPerModelStats } = await import('./inference-report.js');
      const stats = toPerModelStats(rawRow);
      expect(typeof stats.requests).toBe('number');
      expect(typeof stats.tokensIn).toBe('number');
      expect(typeof stats.tokensOut).toBe('number');
      expect(typeof stats.byokTrue).toBe('number');
      expect(typeof stats.byokFalse).toBe('number');
      expect(typeof stats.byokNull).toBe('number');
      expect(typeof stats.latencyMeasured).toBe('number');
      expect(stats).toEqual({
        provider: 'openrouter',
        model: 'glm-4.6',
        requests: 12,
        tokensIn: 1000,
        tokensOut: 500,
        byokTrue: 7,
        byokFalse: 3,
        byokNull: 2,
        latencyMeasured: 9,
        latencyAvgMs: 250.5,
        latencyP95Ms: 900.25,
      });
    });

    it('renders the converted numbers in the markdown table', async () => {
      mockQueryRaw
        .mockResolvedValueOnce([rawRow])
        .mockResolvedValueOnce(emptyCache)
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(emptyPersonality);

      const { telemetryInferenceReport } = await import('./inference-report.js');
      await telemetryInferenceReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('| openrouter | glm-4.6 | 12 | 1000 | 500 | 7 | 3 | 2 | 9 |');
      expect(output).not.toContain('[object');
    });
  });

  describe('null latency', () => {
    it('renders an em dash rather than 0 for unmeasured latency', async () => {
      const perModel: PerModelRawRow[] = [
        {
          provider: 'z-ai',
          model: 'glm-4.5',
          requests: 3n,
          tokens_in: 30n,
          tokens_out: 15n,
          byok_true: 0n,
          byok_false: 3n,
          byok_null: 0n,
          latency_measured: 0n,
          latency_avg_ms: null,
          latency_p95_ms: null,
        },
      ];
      mockQueryRaw
        .mockResolvedValueOnce(perModel)
        .mockResolvedValueOnce(emptyCache)
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(emptyPersonality);

      const { telemetryInferenceReport } = await import('./inference-report.js');
      await telemetryInferenceReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('| — | — |');
    });
  });

  describe('cache hit-rate computation', () => {
    it('computes hitCallShare and readShare from reported cache counts', async () => {
      const { toCacheHitStats } = await import('./inference-report.js');
      const stats = toCacheHitStats({
        provider: 'z-ai',
        model: 'glm-4.6',
        requests: 10n,
        tokens_in: 1000n,
        cache_reported_calls: 10n,
        cache_reported_tokens_in: 1000n,
        cache_hit_calls: 4n,
        cache_read_tokens: 250n,
        cache_read_tokens_for_share: 250n,
        cache_write_tokens: 600n,
      });

      expect(stats).toEqual({
        provider: 'z-ai',
        model: 'glm-4.6',
        requests: 10,
        tokensIn: 1000,
        cacheReportedCalls: 10,
        cacheReportedTokensIn: 1000,
        cacheHitCalls: 4,
        cacheReadTokens: 250,
        cacheWriteTokens: 600,
        hitCallShare: 0.4,
        readShare: 0.25,
      });
    });

    it('computes shares over reported rows only when a group mixes reported and NULL rows', async () => {
      const { toCacheHitStats } = await import('./inference-report.js');
      const stats = toCacheHitStats({
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        requests: 10n,
        tokens_in: 2000n,
        cache_reported_calls: 4n,
        cache_reported_tokens_in: 500n,
        cache_hit_calls: 2n,
        cache_read_tokens: 250n,
        cache_read_tokens_for_share: 250n,
        cache_write_tokens: 100n,
      });

      expect(stats.hitCallShare).toBe(0.5);
      expect(stats.readShare).toBe(0.5);
      expect(stats).toEqual({
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        requests: 10,
        tokensIn: 2000,
        cacheReportedCalls: 4,
        cacheReportedTokensIn: 500,
        cacheHitCalls: 2,
        cacheReadTokens: 250,
        cacheWriteTokens: 100,
        hitCallShare: 0.5,
        readShare: 0.5,
      });
    });

    it('treats a provider-reported 0 cache_read_tokens as a 0% miss rather than null', async () => {
      const { toCacheHitStats } = await import('./inference-report.js');
      const stats = toCacheHitStats({
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        requests: 5n,
        tokens_in: 500n,
        cache_reported_calls: 5n,
        cache_reported_tokens_in: 500n,
        cache_hit_calls: 0n,
        cache_read_tokens: 0n,
        cache_read_tokens_for_share: 0n,
        cache_write_tokens: 500n,
      });

      expect(stats.cacheReadTokens).toBe(0);
      expect(stats.hitCallShare).toBe(0);
      expect(stats.readShare).toBe(0);
    });

    it('returns null shares (never 0) and states so honestly on an all-null fixture', async () => {
      const allNullRow: CacheHitRawRow = {
        provider: 'openrouter',
        model: 'glm-4.6',
        requests: 8n,
        tokens_in: 800n,
        cache_reported_calls: 0n,
        cache_reported_tokens_in: null,
        cache_hit_calls: 0n,
        cache_read_tokens: null,
        cache_read_tokens_for_share: null,
        cache_write_tokens: null,
      };
      const { toCacheHitStats, telemetryInferenceReport } = await import('./inference-report.js');
      const stats = toCacheHitStats(allNullRow);

      expect(stats).toEqual({
        provider: 'openrouter',
        model: 'glm-4.6',
        requests: 8,
        tokensIn: 800,
        cacheReportedCalls: 0,
        cacheReportedTokensIn: null,
        cacheHitCalls: 0,
        cacheReadTokens: null,
        cacheWriteTokens: null,
        hitCallShare: null,
        readShare: null,
      });

      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
        .mockResolvedValueOnce([allNullRow])
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(emptyPersonality);
      await telemetryInferenceReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('## Cache hit rate');
      expect(output).toContain('No cache token data reported in this window');
      expect(output).toContain('| openrouter | glm-4.6 | 8 | 0 | 0 | — | 800 | — | — | — |');
    });

    it('guards division-by-zero when tokens_in or requests is zero', async () => {
      const { toCacheHitStats } = await import('./inference-report.js');
      const stats = toCacheHitStats({
        provider: 'openrouter',
        model: 'glm-4.6',
        requests: 0n,
        tokens_in: 0n,
        cache_reported_calls: 0n,
        cache_reported_tokens_in: 0n,
        cache_hit_calls: 0n,
        cache_read_tokens: 0n,
        cache_read_tokens_for_share: 0n,
        cache_write_tokens: 0n,
      });

      expect(stats.hitCallShare).toBeNull();
      expect(stats.readShare).toBeNull();
    });

    it('excludes write-only rows (cache_read_tokens IS NULL) from the write sum and shares', async () => {
      const { toCacheHitStats, telemetryInferenceReport } = await import('./inference-report.js');
      // SQL filters SUM(cache_write_tokens) FILTER (WHERE cache_read_tokens IS NOT NULL),
      // so a group whose rows report only writes arrives from SQL with cache_write_tokens: null.
      const stats = toCacheHitStats({
        provider: 'openrouter',
        model: 'anthropic/claude-sonnet-4',
        requests: 3n,
        tokens_in: 900n,
        cache_reported_calls: 0n,
        cache_reported_tokens_in: null,
        cache_hit_calls: 0n,
        cache_read_tokens: null,
        cache_read_tokens_for_share: null,
        cache_write_tokens: null,
      });

      expect(stats.cacheReadTokens).toBeNull();
      expect(stats.cacheWriteTokens).toBeNull();
      expect(stats.hitCallShare).toBeNull();
      expect(stats.readShare).toBeNull();

      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
        .mockResolvedValueOnce(emptyCache)
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(emptyPersonality);
      await telemetryInferenceReport({ env: 'local', days: 30 });

      const cacheSql = (mockQueryRaw.mock.calls[1][0] as readonly string[]).join('?');
      expect(cacheSql).toContain(
        'SUM(cache_write_tokens) FILTER (WHERE cache_read_tokens IS NOT NULL)'
      );
      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain(
        'Cache write totals come from the same read-reporting rows (`cache_read_tokens IS NOT NULL`); a row reporting only writes is excluded from the write total but still counts toward `Requests`.'
      );
    });

    it('bounds readShare by excluding token-less rows (tokens_in = 0 -> cache_reported_tokens_in: null)', async () => {
      const { toCacheHitStats, telemetryInferenceReport } = await import('./inference-report.js');
      const stats = toCacheHitStats({
        provider: 'openrouter',
        model: 'glm-4.6',
        requests: 1n,
        tokens_in: 0n,
        cache_reported_calls: 1n,
        cache_reported_tokens_in: null,
        cache_hit_calls: 1n,
        cache_read_tokens: 50n,
        cache_read_tokens_for_share: null,
        cache_write_tokens: 0n,
      });

      expect(stats.cacheReportedTokensIn).toBeNull();
      expect(stats.hitCallShare).toBe(1);
      expect(stats.readShare).toBeNull();

      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
        .mockResolvedValueOnce(emptyCache)
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(emptyPersonality);
      await telemetryInferenceReport({ env: 'local', days: 30 });

      const cacheSql = (mockQueryRaw.mock.calls[1][0] as readonly string[]).join('?');
      expect(cacheSql).toContain(
        'SUM(tokens_in) FILTER (WHERE cache_read_tokens IS NOT NULL AND tokens_in > 0)'
      );
      expect(cacheSql).toContain(
        'SUM(cache_read_tokens) FILTER (WHERE cache_read_tokens IS NOT NULL AND tokens_in > 0) AS cache_read_tokens_for_share'
      );
      expect(cacheSql).toContain(
        'COUNT(*) FILTER (WHERE cache_read_tokens > 0) AS cache_hit_calls'
      );
      expect(cacheSql).toContain(") AND request_type = 'llm_generation'");
      expect((mockQueryRaw.mock.calls[0][0] as readonly string[]).join('?')).not.toContain(
        'request_type'
      );
      expect((mockQueryRaw.mock.calls[2][0] as readonly string[]).join('?')).not.toContain(
        'request_type'
      );
      expect((mockQueryRaw.mock.calls[3][0] as readonly string[]).join('?')).not.toContain(
        'request_type'
      );
    });

    it('bounds readShare numerator to tokens_in > 0 rows on a mixed token-less + normal group while preserving unfiltered cacheReadTokens', async () => {
      const { toCacheHitStats } = await import('./inference-report.js');
      // One token-less row (tokens_in = 0, read = 50) + one normal row (tokens_in = 10, read = 5):
      // unfiltered SUM(cache_read_tokens) is 55n, while the SQL-side FILTER produces
      // cache_read_tokens_for_share = 5n and cache_reported_tokens_in = 10n.
      const stats = toCacheHitStats({
        provider: 'openrouter',
        model: 'glm-4.6',
        requests: 2n,
        tokens_in: 10n,
        cache_reported_calls: 2n,
        cache_reported_tokens_in: 10n,
        cache_hit_calls: 2n,
        cache_read_tokens: 55n,
        cache_read_tokens_for_share: 5n,
        cache_write_tokens: 0n,
      });

      expect(stats.cacheReadTokens).toBe(55);
      expect(stats.readShare).toBe(0.5);
      expect(stats.readShare).toBeLessThanOrEqual(1);
    });

    it('degrades to the unavailable caption without throwing when the cache query fails with 42703', async () => {
      // Simulate a pre-migration database: any query referencing the cache-token
      // columns rejects with Postgres 42703 (undefined_column). If Q1 still
      // selected any cache aggregate, Q1 itself would throw here.
      mockQueryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        if (/cache_read_tokens|cache_write_tokens/.test(sql)) {
          throw Object.assign(
            new Error('column "cache_read_tokens" of relation "usage_logs" does not exist'),
            { code: '42703' }
          );
        }
        return [];
      });

      const { telemetryInferenceReport } = await import('./inference-report.js');
      await expect(telemetryInferenceReport({ env: 'local', days: 30 })).resolves.toBeUndefined();

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('## Per provider/model');
      expect(output).toContain('## Cache hit rate');
      expect(output).toContain(
        'Cache hit rate unavailable: this database predates the cache-token columns (run the migration).'
      );
      expect(output).not.toContain('No chat rows in this window.');
    });

    it('degrades to the unavailable caption without throwing when the cache query fails with a Prisma P2010-wrapped 42703 error', async () => {
      mockQueryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
        const sql = strings.join('?');
        if (/cache_read_tokens|cache_write_tokens/.test(sql)) {
          throw Object.assign(
            new Error(
              'Raw query failed. Code: `42703`. Message: column "cache_read_tokens" does not exist'
            ),
            {
              code: 'P2010',
              meta: { code: '42703' },
            }
          );
        }
        return [];
      });

      const { telemetryInferenceReport } = await import('./inference-report.js');
      await expect(telemetryInferenceReport({ env: 'local', days: 30 })).resolves.toBeUndefined();

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('## Cache hit rate');
      expect(output).toContain(
        'Cache hit rate unavailable: this database predates the cache-token columns (run the migration).'
      );
      expect(output).not.toContain('No chat rows in this window.');
    });

    it('rethrows when the cache query rejects with a non-42703 error', async () => {
      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
        .mockRejectedValueOnce(
          Object.assign(new Error('connection reset by peer'), { code: '08006' })
        );

      const { telemetryInferenceReport } = await import('./inference-report.js');
      await expect(telemetryInferenceReport({ env: 'local', days: 30 })).rejects.toThrow(
        'connection reset by peer'
      );
      expect(mockDispose).toHaveBeenCalled();
    });

    it('rethrows when the cache query rejects with a missing-relation error lacking 42703', async () => {
      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
        .mockRejectedValueOnce(new Error('relation "usage_logs_view" does not exist'));

      const { telemetryInferenceReport } = await import('./inference-report.js');
      await expect(telemetryInferenceReport({ env: 'local', days: 30 })).rejects.toThrow(
        'relation "usage_logs_view" does not exist'
      );
      expect(mockDispose).toHaveBeenCalled();
    });

    it('rethrows when the cache query rejects with 42703 on a non-cache column', async () => {
      mockQueryRaw.mockResolvedValueOnce(emptyPerModel).mockRejectedValueOnce(
        Object.assign(new Error('column "tokens_inn" of relation "usage_logs" does not exist'), {
          code: '42703',
        })
      );

      const { telemetryInferenceReport } = await import('./inference-report.js');
      await expect(telemetryInferenceReport({ env: 'local', days: 30 })).rejects.toThrow(
        'tokens_inn'
      );
      expect(mockDispose).toHaveBeenCalled();
    });
  });

  describe('per-character attribution', () => {
    it('renders "(unattributed)" for a null personality name', async () => {
      const personality: PersonalityRawRow[] = [
        { personality_name: null, requests: 4n, total_tokens: 400n },
      ];
      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
        .mockResolvedValueOnce(emptyCache)
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(personality);

      const { telemetryInferenceReport } = await import('./inference-report.js');
      await telemetryInferenceReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('| (unattributed) | 4 | 400 |');
    });

    it('never prints a raw owner id even when one rides along on a row', async () => {
      const SENTINEL_OWNER_ID = '999888777666555444';
      const personality = [
        {
          personality_name: 'Ava',
          requests: 2n,
          total_tokens: 200n,
          owner_id: SENTINEL_OWNER_ID,
        },
      ] as unknown as PersonalityRawRow[];
      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
        .mockResolvedValueOnce(emptyCache)
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(personality);

      const { telemetryInferenceReport } = await import('./inference-report.js');
      await telemetryInferenceReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).not.toContain(SENTINEL_OWNER_ID);
      expect(output).toContain('| Ava | 2 | 200 |');
    });
  });

  describe('free-tier spend proxy caption', () => {
    it('includes the byok-null-excluded undercount wording', async () => {
      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
        .mockResolvedValueOnce(emptyCache)
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(emptyPersonality);

      const { telemetryInferenceReport } = await import('./inference-report.js');
      await telemetryInferenceReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('## Free-tier spend proxy');
      expect(output.toLowerCase()).toContain('lower bound');
      expect(output).toContain('byok IS NULL');
    });
  });

  describe('--output', () => {
    it('writes the file and prints a note when --output is set', async () => {
      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
        .mockResolvedValueOnce(emptyCache)
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(emptyPersonality);
      const { telemetryInferenceReport } = await import('./inference-report.js');
      await telemetryInferenceReport({ env: 'local', days: 30, output: '/tmp/inference.md' });

      expect(writeFileSync).toHaveBeenCalledWith('/tmp/inference.md', expect.any(String), 'utf-8');
      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('/tmp/inference.md');
    });

    it('prints the markdown to stdout when --output is not set', async () => {
      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
        .mockResolvedValueOnce(emptyCache)
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(emptyPersonality);
      const { telemetryInferenceReport } = await import('./inference-report.js');
      await telemetryInferenceReport({ env: 'local', days: 30 });

      expect(writeFileSync).not.toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('# Inference usage report');
      expect(process.exitCode).toBeUndefined();
    });
  });

  describe('dispose()', () => {
    it('is called in the finally path on success', async () => {
      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
        .mockResolvedValueOnce(emptyCache)
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(emptyPersonality);
      const { telemetryInferenceReport } = await import('./inference-report.js');
      await telemetryInferenceReport({ env: 'local', days: 30 });

      expect(mockDispose).toHaveBeenCalled();
    });

    it('is called in the finally path when a query throws', async () => {
      mockQueryRaw.mockRejectedValueOnce(new Error('db exploded'));
      const { telemetryInferenceReport } = await import('./inference-report.js');

      await expect(telemetryInferenceReport({ env: 'local', days: 30 })).rejects.toThrow(
        'db exploded'
      );
      expect(mockDispose).toHaveBeenCalled();
    });
  });
});
