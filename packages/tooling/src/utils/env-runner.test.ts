import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';

// Mock child_process
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

// Mock chalk
vi.mock('chalk', () => ({
  default: {
    blue: (s: string) => s,
    yellow: (s: string) => s,
    red: Object.assign((s: string) => s, {
      bold: (s: string) => s,
    }),
    dim: (s: string) => s,
    green: (s: string) => s,
  },
}));

describe('env-runner', () => {
  describe('checkRailwayCli', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return true when Railway CLI is authenticated', async () => {
      vi.mocked(execFileSync).mockReturnValue(Buffer.from('user@example.com'));

      const { checkRailwayCli } = await import('./env-runner.js');
      expect(checkRailwayCli()).toBe(true);
      expect(execFileSync).toHaveBeenCalledWith('railway', ['whoami'], { stdio: 'pipe' });
    });

    it('should return false when Railway CLI is not authenticated', async () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('Not logged in');
      });

      // Reset module to get fresh import
      vi.resetModules();
      const { checkRailwayCli } = await import('./env-runner.js');
      expect(checkRailwayCli()).toBe(false);
    });
  });

  describe('getRailwayEnvName', () => {
    it('should map dev to development', async () => {
      const { getRailwayEnvName } = await import('./env-runner.js');
      expect(getRailwayEnvName('dev')).toBe('development');
    });

    it('should map prod to production', async () => {
      const { getRailwayEnvName } = await import('./env-runner.js');
      expect(getRailwayEnvName('prod')).toBe('production');
    });

    it('should throw for local environment', async () => {
      const { getRailwayEnvName } = await import('./env-runner.js');
      expect(() => getRailwayEnvName('local')).toThrow("Cannot map 'local' to Railway environment");
    });
  });

  describe('validateEnvironment', () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let processExitSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.clearAllMocks();
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
      processExitSpy.mockRestore();
      if (originalDatabaseUrl !== undefined) {
        process.env.DATABASE_URL = originalDatabaseUrl;
      } else {
        delete process.env.DATABASE_URL;
      }
    });

    it('should pass for local with DATABASE_URL set', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';

      vi.resetModules();
      const { validateEnvironment } = await import('./env-runner.js');
      validateEnvironment('local');

      expect(processExitSpy).not.toHaveBeenCalled();
    });

    it('should exit for local without DATABASE_URL', async () => {
      delete process.env.DATABASE_URL;

      vi.resetModules();
      const { validateEnvironment } = await import('./env-runner.js');
      validateEnvironment('local');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('DATABASE_URL not set'));
    });

    it('should check Railway CLI for dev environment', async () => {
      vi.mocked(execFileSync).mockReturnValue(Buffer.from('user@example.com'));

      vi.resetModules();
      const { validateEnvironment } = await import('./env-runner.js');
      validateEnvironment('dev');

      expect(execFileSync).toHaveBeenCalledWith('railway', ['whoami'], { stdio: 'pipe' });
    });

    it('should exit if Railway CLI not authenticated for dev', async () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('Not logged in');
      });

      vi.resetModules();
      const { validateEnvironment } = await import('./env-runner.js');
      validateEnvironment('dev');

      expect(processExitSpy).toHaveBeenCalledWith(1);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Railway CLI not authenticated')
      );
    });
  });

  describe('showEnvironmentBanner', () => {
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLogSpy.mockRestore();
    });

    it('should show LOCAL banner for local environment', async () => {
      const { showEnvironmentBanner } = await import('./env-runner.js');
      showEnvironmentBanner('local');

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('LOCAL');
    });

    it('should show RAILWAY DEV banner for dev environment', async () => {
      const { showEnvironmentBanner } = await import('./env-runner.js');
      showEnvironmentBanner('dev');

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('RAILWAY DEV');
    });

    it('should show RAILWAY PROD banner for prod environment', async () => {
      const { showEnvironmentBanner } = await import('./env-runner.js');
      showEnvironmentBanner('prod');

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('RAILWAY PROD');
    });
  });
});
