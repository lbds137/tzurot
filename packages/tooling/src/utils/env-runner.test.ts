import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execFileSync, spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

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

  describe('resolveDatabaseUrl', () => {
    const ORIGINAL_DB_URL = process.env.DATABASE_URL;

    afterEach(() => {
      if (ORIGINAL_DB_URL === undefined) {
        delete process.env.DATABASE_URL;
      } else {
        process.env.DATABASE_URL = ORIGINAL_DB_URL;
      }
    });

    it('returns the local DATABASE_URL for env=local', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost/tzurot';
      const { resolveDatabaseUrl } = await import('./env-runner.js');
      expect(resolveDatabaseUrl('local')).toBe('postgresql://localhost/tzurot');
    });

    it('throws for env=local when DATABASE_URL is unset', async () => {
      delete process.env.DATABASE_URL;
      const { resolveDatabaseUrl } = await import('./env-runner.js');
      expect(() => resolveDatabaseUrl('local')).toThrow(/DATABASE_URL not set/);
    });

    it('fetches the Railway public URL for env=dev', async () => {
      vi.mocked(execFileSync).mockReturnValue(
        JSON.stringify({ DATABASE_PUBLIC_URL: 'postgresql://railway-dev/db' })
      );
      const { resolveDatabaseUrl } = await import('./env-runner.js');
      expect(resolveDatabaseUrl('dev')).toBe('postgresql://railway-dev/db');
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

  describe('cleanEnvForNpx', () => {
    const originalEnv = { ...process.env };

    afterEach(() => {
      // Restore original env
      for (const key of Object.keys(process.env)) {
        if (!(key in originalEnv)) {
          delete process.env[key];
        }
      }
      Object.assign(process.env, originalEnv);
    });

    it('should strip pnpm_config_* vars', async () => {
      process.env.pnpm_config_verify_deps_before_run = 'false';
      process.env.pnpm_config_some_other = 'value';

      vi.resetModules();
      const { cleanEnvForNpx } = await import('./env-runner.js');
      const cleaned = cleanEnvForNpx();

      expect(cleaned.pnpm_config_verify_deps_before_run).toBeUndefined();
      expect(cleaned.pnpm_config_some_other).toBeUndefined();
    });

    it('should strip npm_config_* vars except user_agent', async () => {
      process.env.npm_config_globalconfig = '/some/path';
      process.env.npm_config_verify_deps_before_run = 'false';
      process.env.npm_config_user_agent = 'pnpm/10.22.0';

      vi.resetModules();
      const { cleanEnvForNpx } = await import('./env-runner.js');
      const cleaned = cleanEnvForNpx();

      expect(cleaned.npm_config_globalconfig).toBeUndefined();
      expect(cleaned.npm_config_verify_deps_before_run).toBeUndefined();
      expect(cleaned.npm_config_user_agent).toBe('pnpm/10.22.0');
    });

    it('should preserve non-npm env vars', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';
      process.env.NODE_ENV = 'test';

      vi.resetModules();
      const { cleanEnvForNpx } = await import('./env-runner.js');
      const cleaned = cleanEnvForNpx();

      expect(cleaned.DATABASE_URL).toBe('postgresql://localhost/test');
      expect(cleaned.NODE_ENV).toBe('test');
    });

    it('should merge extra vars into the result', async () => {
      vi.resetModules();
      const { cleanEnvForNpx } = await import('./env-runner.js');
      const cleaned = cleanEnvForNpx({ DATABASE_URL: 'postgresql://railway/db' });

      expect(cleaned.DATABASE_URL).toBe('postgresql://railway/db');
    });

    it('should allow extra vars to override process.env', async () => {
      process.env.DATABASE_URL = 'postgresql://localhost/test';

      vi.resetModules();
      const { cleanEnvForNpx } = await import('./env-runner.js');
      const cleaned = cleanEnvForNpx({ DATABASE_URL: 'postgresql://railway/db' });

      expect(cleaned.DATABASE_URL).toBe('postgresql://railway/db');
    });
  });

  describe('spawned-command timeout (opt-in)', () => {
    // A child that never emits 'close' unless the test tells it to — the stall
    // the timeout exists to bound.
    type MockProc = EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: ReturnType<typeof vi.fn>;
    };

    function mockChild(): MockProc {
      const proc = new EventEmitter() as MockProc;
      proc.stdout = new EventEmitter();
      proc.stderr = new EventEmitter();
      proc.kill = vi.fn();
      vi.mocked(spawn).mockReturnValue(proc as unknown as ReturnType<typeof spawn>);
      return proc;
    }

    beforeEach(() => {
      vi.clearAllMocks();
      vi.resetModules();
      vi.useFakeTimers();
      vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
      vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it('kills the child and rejects when the bound elapses before it exits', async () => {
      const proc = mockChild();
      const { runPrismaCommand } = await import('./env-runner.js');

      const promise = runPrismaCommand('local', 'migrate', ['status'], 5000);
      // Handler attached BEFORE advancing: an unhandled rejection otherwise
      // escapes between the timer firing and the assertion.
      const assertion = expect(promise).rejects.toThrow(
        'Command timed out after 5000ms: npx prisma migrate status'
      );

      await vi.advanceTimersByTimeAsync(5000);
      await assertion;

      expect(proc.kill).toHaveBeenCalled();
    });

    it('resolves and clears the timer when the child exits inside the bound', async () => {
      const proc = mockChild();
      const { runPrismaCommand } = await import('./env-runner.js');

      const promise = runPrismaCommand('local', 'migrate', ['status'], 5000);
      proc.emit('close', 0);

      await expect(promise).resolves.toEqual({ stdout: '', stderr: '', exitCode: 0 });
      // A surviving timer would fire kill() on an already-finished command and
      // hold the event loop open for the rest of the bound.
      expect(vi.getTimerCount()).toBe(0);
      expect(proc.kill).not.toHaveBeenCalled();
    });

    it('arms no timer at all when no bound is passed — `migrate deploy` stays unbounded', async () => {
      const proc = mockChild();
      const { runPrismaCommand } = await import('./env-runner.js');

      const promise = runPrismaCommand('local', 'migrate', ['deploy']);
      expect(vi.getTimerCount()).toBe(0);

      proc.emit('close', 0);
      await expect(promise).resolves.toEqual({ stdout: '', stderr: '', exitCode: 0 });
      expect(proc.kill).not.toHaveBeenCalled();
    });

    it('bounds the Railway URL fetch under the same option', async () => {
      vi.mocked(execFileSync).mockReturnValue(
        JSON.stringify({ DATABASE_PUBLIC_URL: 'postgresql://railway-dev/db' })
      );
      const proc = mockChild();
      const { runWithRailway } = await import('./env-runner.js');

      const promise = runWithRailway('dev', 'npx', ['prisma', 'migrate', 'status'], 5000);
      proc.emit('close', 0);
      await promise;

      expect(execFileSync).toHaveBeenCalledWith(
        'railway',
        expect.any(Array),
        expect.objectContaining({ timeout: 5000 })
      );
    });

    it('leaves the Railway URL fetch options untouched when no bound is passed', async () => {
      vi.mocked(execFileSync).mockReturnValue(
        JSON.stringify({ DATABASE_PUBLIC_URL: 'postgresql://railway-dev/db' })
      );
      const proc = mockChild();
      const { runWithRailway } = await import('./env-runner.js');

      const promise = runWithRailway('dev', 'npx', ['prisma', 'migrate', 'deploy']);
      proc.emit('close', 0);
      await promise;

      expect(execFileSync).toHaveBeenCalledWith('railway', expect.any(Array), {
        stdio: 'pipe',
        encoding: 'utf-8',
      });
    });
  });

  describe('requireProductionConfirmation', () => {
    let exitSpy: ReturnType<typeof vi.spyOn>;
    let logSpy: ReturnType<typeof vi.spyOn>;

    // The prompt dynamically imports node:readline; the doMock intercepts it
    // per-answer so each test controls what the operator "typed".
    function mockAnswer(answer: string): void {
      vi.doMock('node:readline', () => ({
        default: {
          createInterface: () => ({
            question: (_q: string, cb: (a: string) => void) => cb(answer),
            close: vi.fn(),
          }),
        },
        createInterface: () => ({
          question: (_q: string, cb: (a: string) => void) => cb(answer),
          close: vi.fn(),
        }),
      }));
    }

    beforeEach(() => {
      vi.resetModules();
      logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      // Throwing sentinel: the real exit never returns, and the code after
      // the gate must be unreachable on decline.
      exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit called');
      });
    });

    afterEach(() => {
      exitSpy.mockRestore();
      logSpy.mockRestore();
      vi.doUnmock('node:readline');
    });

    it('returns when the operator types "yes"', async () => {
      mockAnswer('yes');
      const { requireProductionConfirmation } = await import('./env-runner.js');

      await expect(requireProductionConfirmation('erase everything')).resolves.toBeUndefined();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('accepts "YES" case-insensitively', async () => {
      mockAnswer('YES');
      const { requireProductionConfirmation } = await import('./env-runner.js');

      await expect(requireProductionConfirmation('erase everything')).resolves.toBeUndefined();
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('prints the cancellation and EXITS (code 0) on any other answer', async () => {
      mockAnswer('no');
      const { requireProductionConfirmation } = await import('./env-runner.js');

      await expect(requireProductionConfirmation('erase everything')).rejects.toThrow(
        'process.exit called'
      );
      expect(exitSpy).toHaveBeenCalledWith(0);
      expect(logSpy.mock.calls.flat().join(' ')).toContain('Operation cancelled');
    });
  });
});
