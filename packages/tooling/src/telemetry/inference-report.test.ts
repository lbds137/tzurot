import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createPrismaClient } from '@tzurot/common-types/services/prisma';
import type { PerModelRawRow, FreeTierRawRow, PersonalityRawRow } from './inference-report.js';

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

  // queryReportData issues its three queries in this fixed order:
  // 1. per-provider/model, 2. free-tier spend proxy, 3. per-personality attribution.
  const emptyPerModel: PerModelRawRow[] = [];
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
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(emptyPersonality);
      const { telemetryInferenceReport } = await import('./inference-report.js');
      await telemetryInferenceReport({ env: 'local', days: '7' });

      expect(createPrismaClient).toHaveBeenCalled();
      expect(mockQueryRaw).toHaveBeenCalledTimes(3);
      // Tagged template: call[0] is the strings array, call[1] the first bind.
      // Asserting the VALUE (not just that a call happened) is what catches a
      // window silently pinned to the default on one of the three queries.
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
        .mockResolvedValueOnce(emptyFreeTier)
        .mockResolvedValueOnce(emptyPersonality);

      const { telemetryInferenceReport } = await import('./inference-report.js');
      await telemetryInferenceReport({ env: 'local', days: 30 });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('| — | — |');
    });
  });

  describe('per-character attribution', () => {
    it('renders "(unattributed)" for a null personality name', async () => {
      const personality: PersonalityRawRow[] = [
        { personality_name: null, requests: 4n, total_tokens: 400n },
      ];
      mockQueryRaw
        .mockResolvedValueOnce(emptyPerModel)
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
