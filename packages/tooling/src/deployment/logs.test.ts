import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    cyan: Object.assign((s: string) => s, { bold: (s: string) => s }),
    green: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    dim: (s: string) => s,
  },
}));

// Mock child_process - use vi.fn() inside factory
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn().mockReturnValue(''),
  spawn: vi.fn(),
}));

// Mock env-runner
vi.mock('../utils/env-runner.js', () => ({
  checkRailwayCli: vi.fn().mockReturnValue(true),
  getRailwayEnvName: vi.fn((env: string) => (env === 'dev' ? 'development' : 'production')),
}));

import { execFileSync } from 'node:child_process';
import { fetchLogs, parseSinceMs } from './logs.js';

describe('fetchLogs', () => {
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let originalExitCode: typeof process.exitCode;

  beforeEach(async () => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalExitCode = process.exitCode;
    process.exitCode = undefined;

    // Reset env-runner mocks to default
    const envRunner = await import('../utils/env-runner.js');
    vi.mocked(envRunner.checkRailwayCli).mockReturnValue(true);
    vi.mocked(envRunner.getRailwayEnvName).mockImplementation((env: string) =>
      env === 'dev' ? 'development' : 'production'
    );

    // Default: successful log fetch
    vi.mocked(execFileSync).mockReturnValue('2024-01-24 10:00:00 INFO: Application started\n');
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.exitCode = originalExitCode;
  });

  it('should export fetchLogs function', () => {
    expect(typeof fetchLogs).toBe('function');
  });

  describe('basic functionality', () => {
    it('should display environment header', async () => {
      await fetchLogs({ env: 'dev' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('RAILWAY LOGS');
      expect(output).toContain('DEVELOPMENT');
    });

    it('defaults to 100 lines in plain (non-dig) mode', async () => {
      // The dig default is 5000; a ternary flip that applied it to plain
      // fetches too would silently make every casual tail 50x heavier.
      await fetchLogs({ env: 'dev' });

      const args = vi.mocked(execFileSync).mock.calls[0][1] as string[];
      expect(args[args.indexOf('-n') + 1]).toBe('100');
    });

    it('should fetch logs with correct Railway arguments', async () => {
      await fetchLogs({ env: 'dev', lines: 50 });

      expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
        'railway',
        ['logs', '--environment', 'development', '-n', '50'],
        expect.anything()
      );
    });

    it('should include service in arguments when specified', async () => {
      await fetchLogs({ env: 'dev', service: 'api-gateway' });

      expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
        'railway',
        expect.arrayContaining(['--service', 'api-gateway']),
        expect.anything()
      );
    });

    it('should display logs', async () => {
      vi.mocked(execFileSync).mockReturnValue('2024-01-24 10:00:00 INFO: Test log message\n');

      await fetchLogs({ env: 'dev' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Test log message');
    });
  });

  describe('service validation', () => {
    it('should accept known services', async () => {
      await fetchLogs({ env: 'dev', service: 'bot-client' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).not.toContain('Unknown service');
    });

    it('should warn about unknown services', async () => {
      await fetchLogs({ env: 'dev', service: 'unknown-service' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Unknown service');
    });
  });

  describe('--filter passthrough', () => {
    it('should pass --filter through to Railway CLI args', async () => {
      await fetchLogs({ env: 'dev', filter: '@level:error' });

      expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
        'railway',
        expect.arrayContaining(['--filter', '@level:error']),
        expect.anything()
      );
    });

    it('should pass complex Railway DSL queries unchanged', async () => {
      await fetchLogs({ env: 'dev', filter: 'vision AND (404 OR 400)' });

      expect(vi.mocked(execFileSync)).toHaveBeenCalledWith(
        'railway',
        expect.arrayContaining(['--filter', 'vision AND (404 OR 400)']),
        expect.anything()
      );
    });

    it('should omit --filter when not provided', async () => {
      await fetchLogs({ env: 'dev' });

      const callArgs = vi.mocked(execFileSync).mock.calls[0]?.[1] as string[];
      expect(callArgs).not.toContain('--filter');
    });

    it('should not filter output client-side (Railway owns filtering)', async () => {
      // Railway returns only matching lines when --filter is used. Our wrapper
      // must print them verbatim — no client-side grep on top.
      vi.mocked(execFileSync).mockReturnValue('Database connection failed\nAnother message\n');

      await fetchLogs({ env: 'dev', filter: 'database' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Database connection failed');
      expect(output).toContain('Another message');
    });
  });

  describe('error handling', () => {
    it('should handle Railway CLI errors', async () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('service not found');
      });

      await fetchLogs({ env: 'dev', service: 'nonexistent' });

      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Service not found');
      expect(process.exitCode).toBe(1);
    });

    it('should handle project not linked error', async () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('not linked');
      });

      await fetchLogs({ env: 'dev' });

      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Railway project not linked');
    });
  });

  describe('Railway CLI validation', () => {
    it('should fail when Railway CLI is not authenticated', async () => {
      const { checkRailwayCli } = await import('../utils/env-runner.js');
      vi.mocked(checkRailwayCli).mockReturnValue(false);

      await fetchLogs({ env: 'dev' });

      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Railway CLI not authenticated');
      expect(process.exitCode).toBe(1);
    });
  });

  describe('tips display', () => {
    it('should show helpful tips', async () => {
      // Ensure checkRailwayCli returns true
      const { checkRailwayCli } = await import('../utils/env-runner.js');
      vi.mocked(checkRailwayCli).mockReturnValue(true);

      await fetchLogs({ env: 'dev' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Tips');
      expect(output).toContain('ops logs');
    });
  });

  describe('correlation dig mode (--request-id / --job-id)', () => {
    const REQ = 'f333a5db-aaaa-bbbb-cccc-0123456789ab';

    it('local-matches the request ID instead of using the server DSL', async () => {
      vi.mocked(execFileSync).mockReturnValue(
        `{"time":1751500000000,"requestId":"${REQ}","msg":"job queued"}\n` +
          `{"time":1751500001000,"requestId":"other-req","msg":"unrelated"}\n`
      );

      await fetchLogs({ env: 'prod', service: 'api-gateway', requestId: REQ });

      // The fetch args must NOT carry --filter (DSL is unreliable for UUIDs)
      const args = vi.mocked(execFileSync).mock.calls[0][1] as string[];
      expect(args).not.toContain('--filter');
      // Dig default window, not the last screenful
      expect(args).toContain('-n');
      expect(args[args.indexOf('-n') + 1]).toBe('5000');

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('job queued');
      expect(output).not.toContain('unrelated');
    });

    it('sweeps all three app services when no --service is given', async () => {
      vi.mocked(execFileSync).mockReturnValue('');

      await fetchLogs({ env: 'prod', requestId: REQ });

      const serviceArgs = vi
        .mocked(execFileSync)
        .mock.calls.map(call => {
          const args = call[1] as string[];
          return args[args.indexOf('--service') + 1];
        })
        .sort();
      expect(serviceArgs).toEqual(['ai-worker', 'api-gateway', 'bot-client']);
    });

    it('requires ALL terms when both request-id and job-id are given', async () => {
      vi.mocked(execFileSync).mockReturnValue(
        `{"requestId":"${REQ}","jobId":"42317","msg":"both"}\n` +
          `{"requestId":"${REQ}","jobId":"99999","msg":"request only"}\n`
      );

      await fetchLogs({ env: 'prod', service: 'ai-worker', requestId: REQ, jobId: '42317' });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('both');
      expect(output).not.toContain('request only');
    });

    it('rejects combining dig flags with --follow', async () => {
      await fetchLogs({ env: 'prod', requestId: REQ, follow: true });

      expect(process.exitCode).toBe(1);
      const errors = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(errors).toContain('cannot combine with --follow');
      expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
    });

    it('clamps --lines above the Railway CLI cap instead of erroring to zero rows', async () => {
      vi.mocked(execFileSync).mockReturnValue('');

      await fetchLogs({ env: 'prod', service: 'ai-worker', requestId: REQ, lines: 8000 });

      const args = vi.mocked(execFileSync).mock.calls[0][1] as string[];
      expect(args[args.indexOf('-n') + 1]).toBe('5000');
      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('clamping to 5000');
    });
  });

  describe('--since time floor', () => {
    const FROZEN_NOW = 1_751_500_000_000;

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(FROZEN_NOW);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('drops lines older than the floor (and lines without a pino time)', async () => {
      vi.mocked(execFileSync).mockReturnValue(
        `{"time":${FROZEN_NOW - 60_000},"msg":"recent line"}\n` +
          `{"time":${FROZEN_NOW - 7_200_000},"msg":"stale line"}\n` +
          `no-json boot noise\n`
      );

      await fetchLogs({ env: 'prod', service: 'ai-worker', since: '30m' });

      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('recent line');
      expect(output).not.toContain('stale line');
      expect(output).not.toContain('boot noise');
    });

    it('rejects an unparseable --since value', async () => {
      await fetchLogs({ env: 'prod', since: 'yesterday-ish' });

      expect(process.exitCode).toBe(1);
      const errors = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(errors).toContain('Cannot parse --since');
    });
  });

  describe('dig-mode composition and failure paths', () => {
    const REQ = 'f333a5db-aaaa-bbbb-cccc-0123456789ab';

    it('passes an explicit --filter through to the server AND still matches locally', async () => {
      vi.mocked(execFileSync).mockReturnValue(
        `{"level":50,"requestId":"${REQ}","msg":"target error"}\n` +
          `{"level":50,"requestId":"someone-else","msg":"other error"}\n`
      );

      await fetchLogs({
        env: 'prod',
        service: 'ai-worker',
        requestId: REQ,
        filter: '@level:error',
      });

      const args = vi.mocked(execFileSync).mock.calls[0][1] as string[];
      expect(args[args.indexOf('--filter') + 1]).toBe('@level:error');
      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('target error');
      expect(output).not.toContain('other error');
    });

    it('continues the sweep when one service errors', async () => {
      vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
        const serviceArgs = args as string[];
        if (serviceArgs.includes('bot-client')) {
          throw new Error('service not found');
        }
        return `{"requestId":"${REQ}","msg":"worker hit"}\n`;
      });

      await fetchLogs({ env: 'prod', requestId: REQ });

      // All three services attempted despite the first failing
      expect(vi.mocked(execFileSync)).toHaveBeenCalledTimes(3);
      expect(process.exitCode).toBe(1);
      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('worker hit');
    });

    it('rejects a non-numeric --lines instead of forwarding -n NaN', async () => {
      await fetchLogs({ env: 'prod', service: 'ai-worker', lines: Number('abc') });

      expect(process.exitCode).toBe(1);
      const errors = consoleErrorSpy.mock.calls.flat().join(' ');
      expect(errors).toContain('--lines must be a positive number');
      expect(vi.mocked(execFileSync)).not.toHaveBeenCalled();
    });
  });
});

describe('parseSinceMs', () => {
  const NOW = 1_751_500_000_000;

  it.each([
    ['45m', NOW - 45 * 60_000],
    ['6h', NOW - 6 * 3_600_000],
    ['2d', NOW - 2 * 86_400_000],
    ['45M', NOW - 45 * 60_000],
    ['6H', NOW - 6 * 3_600_000],
  ])('parses relative %s (case-insensitive)', (input, expected) => {
    expect(parseSinceMs(input, NOW)).toBe(expected);
  });

  it('parses ISO-8601 timestamps', () => {
    expect(parseSinceMs('2026-07-03T02:00:00.000Z', NOW)).toBe(
      Date.parse('2026-07-03T02:00:00.000Z')
    );
  });

  it('throws on garbage', () => {
    expect(() => parseSinceMs('soonish', NOW)).toThrow('Cannot parse --since');
  });
});
