import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import type { UpstreamRawRow } from './upstream-report.js';

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

// 12 requests: 2 failed, so the 10 non-failed rows split across the finish reasons.
const rawRow: UpstreamRawRow = {
  model: 'anthropic/claude-haiku-5.5',
  upstream: 'Anthropic',
  requests: 12n,
  failed: 2n,
  finish_stop: 8n,
  finish_length: 1n,
  finish_content_filter: 0n,
  finish_error: 0n,
  finish_other: 1n,
  empty_replies: 2n,
  avg_completion_tokens: 88.5,
};

/**
 * The query text with each `${}` bind replaced by `?`, and every bind value in
 * order, as the seam tests read them. The natural-stop list is the first bind.
 */
function sqlOf(mockQueryRaw: ReturnType<typeof vi.fn>): { sql: string; binds: unknown[] } {
  const [strings, ...binds] = mockQueryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]];
  return { sql: strings.join('?'), binds };
}

describe('upstream-report', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let mockQueryRaw: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-25T12:00:00.000Z'));
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    process.exitCode = undefined;
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
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: invalid as never });

      expect(createPrismaClient).not.toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });

  describe('default window', () => {
    it('uses the 7-day diagnostic retention when --days is omitted', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local' });

      const { binds } = sqlOf(mockQueryRaw);
      // The window days bind is second from the end; the provider bind follows it.
      expect(binds.at(-2)).toBe(7);
      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(output).toContain('Window: trailing 7 days · env: local');
    });
  });

  describe('query shape (seam)', () => {
    it('binds the stop list, the finish literals, the window, and the provider, in SQL order', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });

      expect(mockQueryRaw).toHaveBeenCalledTimes(1);
      const { sql, binds } = sqlOf(mockQueryRaw);
      // Binds in SQL order: the stop list (finish_stop), the three non-stop finish
      // literals (finish_length, finish_content_filter, finish_error), the same three
      // again (finish_other's NOT IN), the stop list again (finish_other's exclusion),
      // the window days, then the provider.
      const stop = ['stop', 'end_turn', 'STOP', 'stop_sequence'];
      expect(binds).toEqual([
        stop,
        'length',
        'content_filter',
        'error',
        'length',
        'content_filter',
        'error',
        stop,
        7,
        'openrouter',
      ]);
      expect(sql).toContain("WHERE created_at >= now() - (interval '1 day' * ?");
      expect(sql).toContain('AND provider = ?');
      expect(sql).toContain('FROM llm_diagnostic_logs');
    });

    it('takes the provider and the finish literals from their constants, not inline strings', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });

      const { sql, binds } = sqlOf(mockQueryRaw);
      expect(sql).not.toContain("= 'length'");
      expect(sql).not.toContain("= 'content_filter'");
      expect(sql).not.toContain("= 'error'");
      expect(sql).not.toContain("provider = 'openrouter'");
      expect(binds).toContain('openrouter');
    });

    it('stop-counts stop_sequence while NATURAL_STOP_REASONS itself stays unchanged', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });

      const { binds } = sqlOf(mockQueryRaw);
      expect(binds[0]).toContain('stop_sequence');
      const { NATURAL_STOP_REASONS } = await import('@tzurot/common-types/constants/finishReasons');
      expect(NATURAL_STOP_REASONS).not.toContain('stop_sequence');
    });

    it('matches stop against every natural-stop spelling via = ANY, not a single literal', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });

      const { sql } = sqlOf(mockQueryRaw);
      expect(sql).toContain("finishReason' = ANY(?) AND data->'error' IS NULL) AS finish_stop");
      expect(sql).not.toContain("finishReason' = 'stop'");
    });

    it('pins the JSON paths the report reads', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });

      const { sql } = sqlOf(mockQueryRaw);
      expect(sql).toContain("data->'llmResponse'->'reasoningDebug'->>'upstreamProvider'");
      expect(sql).toContain("data->'llmResponse'->>'finishReason'");
      expect(sql).toContain("jsonb_typeof(data->'llmResponse'->'completionTokens') = 'number'");
      expect(sql).toContain("(data->'llmResponse'->>'completionTokens')::float8");
    });

    it('counts failed rows by the top-level error field and excludes them from the other columns', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });

      const { sql } = sqlOf(mockQueryRaw);
      expect(sql).toContain("COUNT(*) FILTER (WHERE data->'error' IS NOT NULL) AS failed");
      // Six non-failed-only predicates: stop, length, content_filter, error, other, avg.
      // Empty is deliberately not among them (see the empty-reply test below).
      expect(sql.match(/data->'error' IS NULL/g)).toHaveLength(6);
    });

    it('counts finish_error as its own column over non-failed rows only', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });

      const { sql } = sqlOf(mockQueryRaw);
      expect(sql).toContain(
        "COUNT(*) FILTER (WHERE data->'llmResponse'->>'finishReason' = ? AND data->'error' IS NULL) AS finish_error"
      );
    });

    it('counts empty replies on blank rawContent alone, without an error guard', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });

      const { sql } = sqlOf(mockQueryRaw);
      // Empty-after-retries failures carry blank rawContent AND an error, so the
      // Empty column must not exclude failed rows.
      expect(sql).toContain(
        "COUNT(*) FILTER (WHERE data->'llmResponse' IS NOT NULL\n                              AND length(btrim(COALESCE(data->'llmResponse'->>'rawContent',''))) = 0) AS empty_replies"
      );
    });

    it('averages only non-failed rows with a positive numeric completionTokens', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });

      const { sql } = sqlOf(mockQueryRaw);
      expect(sql).toContain(
        "THEN CASE WHEN (data->'llmResponse'->>'completionTokens')::float8 > 0"
      );
    });

    it('never selects the data column whole and never names the reply preview', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });

      const { sql } = sqlOf(mockQueryRaw);
      expect(sql).not.toContain('rawContentPreview');
      expect(sql).not.toMatch(/SELECT\s+data\b/i);
      expect(sql).not.toMatch(/,\s*data\s*(,|FROM)/i);
      // rawContent appears exactly once in the empty predicate (length() only). The
      // finish-reason/average paths never touch the reply text.
      expect(sql.match(/rawContent/g)).toHaveLength(1);
      expect(sql).toContain("length(btrim(COALESCE(data->'llmResponse'->>'rawContent'");
    });
  });

  describe('bigint conversion', () => {
    it('converts every count to a plain JS number (typeof, not just string content)', async () => {
      // A bigint stringifies to the same digits as a number in a template
      // literal, so assert typeof on the domain object directly.
      const { toUpstreamStats } = await import('./upstream-report.js');
      const stats = toUpstreamStats(rawRow);
      expect(typeof stats.requests).toBe('number');
      expect(typeof stats.failed).toBe('number');
      expect(typeof stats.finishStop).toBe('number');
      expect(typeof stats.finishLength).toBe('number');
      expect(typeof stats.finishContentFilter).toBe('number');
      expect(typeof stats.finishError).toBe('number');
      expect(typeof stats.finishOther).toBe('number');
      expect(typeof stats.emptyReplies).toBe('number');
      expect(stats.requests).toBe(12);
      expect(stats.failed).toBe(2);
      expect(stats.emptyReplies).toBe(2);
    });

    it('passes a null average through as null, never 0', async () => {
      const { toUpstreamStats } = await import('./upstream-report.js');
      const stats = toUpstreamStats({ ...rawRow, avg_completion_tokens: null });
      expect(stats.avgCompletionTokens).toBeNull();
    });

    it('keeps a numeric average as a number', async () => {
      const { toUpstreamStats } = await import('./upstream-report.js');
      expect(toUpstreamStats(rawRow).avgCompletionTokens).toBe(88.5);
    });
  });

  describe('end-to-end render', () => {
    it('renders the converted row from the query result', async () => {
      mockQueryRaw.mockResolvedValueOnce([rawRow]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(output).toContain(
        '| anthropic/claude-haiku-5.5 | Anthropic | 12 | 2 | 100.0% | 8 | 1 | 0 | 0 | 1 | 2 | 89 |'
      );
    });

    it('prints the empty-result line when the window has no rows', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });

      const output = consoleLogSpy.mock.calls.map((c: unknown[]) => String(c[0])).join('\n');
      expect(output).toContain('No OpenRouter diagnostic rows in this window.');
    });
  });

  describe('dispose()', () => {
    it('is called in the finally path on success', async () => {
      mockQueryRaw.mockResolvedValueOnce([]);
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await telemetryUpstreamReport({ env: 'local', days: '7' });
      expect(mockDispose).toHaveBeenCalledTimes(1);
    });

    it('is called in the finally path when the query throws', async () => {
      mockQueryRaw.mockRejectedValueOnce(new Error('boom'));
      const { telemetryUpstreamReport } = await import('./upstream-report.js');
      await expect(telemetryUpstreamReport({ env: 'local', days: '7' })).rejects.toThrow('boom');
      expect(mockDispose).toHaveBeenCalledTimes(1);
    });
  });
});
