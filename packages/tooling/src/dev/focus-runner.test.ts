/**
 * Tests for focus-runner
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track mock state
const mockExecFileSync = vi.fn();
const mockSpawnSync = vi.fn();

// Mock child_process
vi.mock('node:child_process', () => ({
  execFileSync: mockExecFileSync,
  spawnSync: mockSpawnSync,
}));

describe('focus-runner', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

    // Default successful spawn
    mockSpawnSync.mockReturnValue({
      status: 0,
      signal: null,
      pid: 123,
      output: ['', 'success', ''],
      stdout: 'success',
      stderr: '',
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock('../resource/envFile.js');
  });

  describe('runFocusedTask', () => {
    it('should export runFocusedTask function', async () => {
      const module = await import('./focus-runner.js');
      expect(typeof module.runFocusedTask).toBe('function');
    });

    it('should run turbo with all flag when --all is passed', async () => {
      const { runFocusedTask } = await import('./focus-runner.js');

      runFocusedTask({ task: 'lint', all: true });

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'turbo',
        ['run', 'lint'],
        expect.objectContaining({ stdio: 'inherit', shell: false })
      );
      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should include filter when detecting git base', async () => {
      // Setup git commands to return feature branch with develop
      mockExecFileSync
        .mockReturnValueOnce('feature-branch\n') // git branch --show-current
        .mockReturnValueOnce('abc123\n') // git rev-parse origin/develop
        .mockReturnValueOnce(''); // git status --porcelain

      const { runFocusedTask } = await import('./focus-runner.js');

      runFocusedTask({ task: 'test' });

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'turbo',
        ['run', 'test', '--filter', '...[origin/develop]'],
        expect.anything()
      );
    });

    it('bounds every git call with FOCUS_RUNNER_TIMEOUT_MS', async () => {
      // envFile's main-checkout probe is its own git call outside this
      // runner's bounded helpers; stub it so only the runner's calls count.
      vi.doMock('../resource/envFile.js', () => ({ readEnvFileValues: () => ({}) }));
      mockExecFileSync
        .mockReturnValueOnce('feature-branch\n') // git branch --show-current
        .mockReturnValueOnce('abc123\n') // git rev-parse origin/develop
        .mockReturnValueOnce(''); // git status --porcelain

      const { runFocusedTask, FOCUS_RUNNER_TIMEOUT_MS } = await import('./focus-runner.js');

      runFocusedTask({ task: 'test' });

      expect(mockExecFileSync).toHaveBeenCalledTimes(3);
      for (const call of mockExecFileSync.mock.calls) {
        expect(call[2]).toMatchObject({ timeout: FOCUS_RUNNER_TIMEOUT_MS });
      }
    });

    it('should use HEAD^1 when on main branch', async () => {
      // Setup git commands for main branch
      mockExecFileSync
        .mockReturnValueOnce('main\n') // git branch --show-current
        .mockReturnValueOnce(''); // git status --porcelain

      const { runFocusedTask } = await import('./focus-runner.js');

      runFocusedTask({ task: 'lint' });

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'turbo',
        ['run', 'lint', '--filter', '...[HEAD^1]'],
        expect.anything()
      );
    });

    it('should fallback to origin/main when origin/develop does not exist', async () => {
      mockExecFileSync
        .mockReturnValueOnce('feature-branch\n') // git branch --show-current
        .mockImplementationOnce(() => {
          throw new Error('Not found');
        }) // git rev-parse origin/develop fails
        .mockReturnValueOnce('abc123\n') // git rev-parse origin/main succeeds
        .mockReturnValueOnce(''); // git status --porcelain

      const { runFocusedTask } = await import('./focus-runner.js');

      runFocusedTask({ task: 'typecheck' });

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'turbo',
        ['run', 'typecheck', '--filter', '...[origin/main]'],
        expect.anything()
      );
    });

    it('should run on all packages when git base cannot be determined', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('Git error');
      });

      const { runFocusedTask } = await import('./focus-runner.js');

      runFocusedTask({ task: 'build' });

      // No filter should be added
      expect(mockSpawnSync).toHaveBeenCalledWith('turbo', ['run', 'build'], expect.anything());

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Could not determine git base');
    });

    it('should pass extra args after --', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('Git error');
      });

      const { runFocusedTask } = await import('./focus-runner.js');

      runFocusedTask({ task: 'lint', extraArgs: ['--quiet', '--format=pretty'] });

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'turbo',
        ['run', 'lint', '--', '--quiet', '--format=pretty'],
        expect.anything()
      );
    });

    it('should detect and log uncommitted changes', async () => {
      mockExecFileSync
        .mockReturnValueOnce('feature-branch\n') // git branch --show-current
        .mockReturnValueOnce('abc123\n') // git rev-parse origin/develop
        .mockReturnValueOnce(' M src/file.ts\n'); // git status --porcelain (has changes)

      const { runFocusedTask } = await import('./focus-runner.js');

      runFocusedTask({ task: 'test' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('uncommitted changes');
    });

    it('should exit with non-zero status on turbo failure', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('Git error');
      });

      mockSpawnSync.mockReturnValue({
        status: 1,
        signal: null,
        pid: 123,
        output: ['', '', 'Error'],
        stdout: '',
        stderr: 'Error',
      });

      const { runFocusedTask } = await import('./focus-runner.js');

      runFocusedTask({ task: 'test' });

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle spawn error gracefully', async () => {
      mockExecFileSync.mockImplementation(() => {
        throw new Error('Git error');
      });

      mockSpawnSync.mockReturnValue({
        status: null,
        signal: null,
        pid: 123,
        output: [],
        stdout: '',
        stderr: '',
        error: new Error('Command not found'),
      });

      const { runFocusedTask } = await import('./focus-runner.js');

      runFocusedTask({ task: 'lint' });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('hands the spawn the resolved profile env for a low resolution', async () => {
      // Empty strings read as unset, so ambient knob values cannot leak in.
      vi.stubEnv('RESOURCE_PROFILE', '');
      vi.stubEnv('LOW_RESOURCE_MODE', '1');
      vi.stubEnv('TURBO_CONCURRENCY', '');
      vi.stubEnv('VITEST_MAX_WORKERS', '');

      const { runFocusedTask } = await import('./focus-runner.js');

      runFocusedTask({ task: 'lint', all: true });

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'turbo',
        ['run', 'lint'],
        expect.objectContaining({
          env: expect.objectContaining({ RESOURCE_PROFILE: 'low', TURBO_CONCURRENCY: '1' }),
        })
      );
      const stderrLines = consoleErrorSpy.mock.calls.flat().join('\n');
      expect(stderrLines).toContain('resource profile: low');
    });

    it('reads RESOURCE_PROFILE from the checkout .env when env does not carry it', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'focus-runner-env-'));
      const cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
      try {
        writeFileSync(join(dir, '.env'), 'RESOURCE_PROFILE=cloud\n');
        vi.stubEnv('RESOURCE_PROFILE', '');
        vi.stubEnv('LOW_RESOURCE_MODE', '');
        vi.stubEnv('TURBO_CONCURRENCY', '');
        vi.stubEnv('VITEST_MAX_WORKERS', '');

        const { runFocusedTask } = await import('./focus-runner.js');

        runFocusedTask({ task: 'lint', all: true });

        expect(mockSpawnSync).toHaveBeenCalledWith(
          'turbo',
          ['run', 'lint'],
          expect.objectContaining({
            env: expect.objectContaining({ RESOURCE_PROFILE: 'cloud', TURBO_CONCURRENCY: '2' }),
          })
        );
      } finally {
        cwdSpy.mockRestore();
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('propagates a resolver UsageError to the cli reporter before spawning', async () => {
      vi.stubEnv('RESOURCE_PROFILE', 'bogus');

      const { runFocusedTask } = await import('./focus-runner.js');

      // vi.resetModules gives the module its own UsageError class, so match by name.
      expect(() => runFocusedTask({ task: 'lint', all: true })).toThrow(
        expect.objectContaining({
          name: 'UsageError',
          message: expect.stringContaining('RESOURCE_PROFILE') as string,
        })
      );
      expect(mockSpawnSync).not.toHaveBeenCalled();
    });
  });
});
