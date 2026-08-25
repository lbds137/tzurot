import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { writeFileSync } from 'node:fs';
import { createPrismaClient } from '@tzurot/common-types/services/prisma';

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

describe('reportRunner', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.exitCode = undefined;
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(createPrismaClient).mockReturnValue({
      prisma: { $queryRaw: vi.fn() },
      dispose: mockDispose,
    } as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('parseDays', () => {
    it('defaults to 30 when undefined', async () => {
      const { parseDays } = await import('./reportRunner.js');
      expect(parseDays(undefined)).toBe(30);
    });

    it('accepts a valid positive integer string', async () => {
      const { parseDays } = await import('./reportRunner.js');
      expect(parseDays('7')).toBe(7);
    });

    it('accepts a valid positive integer number', async () => {
      const { parseDays } = await import('./reportRunner.js');
      expect(parseDays(14)).toBe(14);
    });

    it.each([0, -1, 2.5, 'abc'])('rejects invalid --days value %p', async input => {
      const { parseDays } = await import('./reportRunner.js');
      expect(() => parseDays(input as never)).toThrow();
    });
  });

  describe('runTelemetryReport', () => {
    it.each([0, -1, 2.5, 'abc'])(
      'rejects --days %p with exit code 1 and never constructs a DB client or runs the callback',
      async invalid => {
        const buildMarkdown = vi.fn();
        const { runTelemetryReport } = await import('./reportRunner.js');
        await runTelemetryReport({ env: 'local', days: invalid as never }, buildMarkdown);

        expect(createPrismaClient).not.toHaveBeenCalled();
        expect(buildMarkdown).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(process.exitCode).toBe(1);
      }
    );

    it('passes the live client, env, and parsed days to the callback', async () => {
      const buildMarkdown = vi.fn().mockResolvedValue('# md');
      const { runTelemetryReport } = await import('./reportRunner.js');
      await runTelemetryReport({ env: 'local', days: '7' }, buildMarkdown);

      expect(buildMarkdown).toHaveBeenCalledWith(
        expect.objectContaining({ $queryRaw: expect.any(Function) }),
        'local',
        7
      );
      expect(process.exitCode).toBeUndefined();
    });

    it('writes the file and prints a note when output is set', async () => {
      const buildMarkdown = vi.fn().mockResolvedValue('# md');
      const { runTelemetryReport } = await import('./reportRunner.js');
      await runTelemetryReport({ env: 'local', days: 30, output: '/tmp/r.md' }, buildMarkdown);

      expect(writeFileSync).toHaveBeenCalledWith('/tmp/r.md', '# md', 'utf-8');
      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('/tmp/r.md');
    });

    it('prints the markdown to stdout when output is not set', async () => {
      const buildMarkdown = vi.fn().mockResolvedValue('# md');
      const { runTelemetryReport } = await import('./reportRunner.js');
      await runTelemetryReport({ env: 'local', days: 30 }, buildMarkdown);

      expect(writeFileSync).not.toHaveBeenCalled();
      const output = consoleLogSpy.mock.calls.flat().join('\n');
      expect(output).toContain('# md');
    });

    it('resolves the Railway database URL for non-local envs only', async () => {
      const buildMarkdown = vi.fn().mockResolvedValue('# md');
      const { runTelemetryReport } = await import('./reportRunner.js');

      await runTelemetryReport({ env: 'local', days: 30 }, buildMarkdown);
      expect(envRunnerMock.getRailwayDatabaseUrl).not.toHaveBeenCalled();

      await runTelemetryReport({ env: 'prod', days: 30 }, buildMarkdown);
      expect(envRunnerMock.getRailwayDatabaseUrl).toHaveBeenCalledWith('prod');
    });

    it('disposes the client on success', async () => {
      const buildMarkdown = vi.fn().mockResolvedValue('# md');
      const { runTelemetryReport } = await import('./reportRunner.js');
      await runTelemetryReport({ env: 'local', days: 30 }, buildMarkdown);

      expect(mockDispose).toHaveBeenCalled();
    });

    it('disposes the client when the callback throws, and rethrows', async () => {
      const buildMarkdown = vi.fn().mockRejectedValue(new Error('db exploded'));
      const { runTelemetryReport } = await import('./reportRunner.js');

      await expect(runTelemetryReport({ env: 'local', days: 30 }, buildMarkdown)).rejects.toThrow(
        'db exploded'
      );
      expect(mockDispose).toHaveBeenCalled();
    });
  });
});
