/**
 * Tests for focus-runner
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track mock state
const mockExecSync = vi.fn();
const mockSpawnSync = vi.fn();

// Mock child_process
vi.mock('node:child_process', () => ({
  execSync: mockExecSync,
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
      mockExecSync
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

    it('should use HEAD^1 when on main branch', async () => {
      // Setup git commands for main branch
      mockExecSync
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
      mockExecSync
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
      mockExecSync.mockImplementation(() => {
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
      mockExecSync.mockImplementation(() => {
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
      mockExecSync
        .mockReturnValueOnce('feature-branch\n') // git branch --show-current
        .mockReturnValueOnce('abc123\n') // git rev-parse origin/develop
        .mockReturnValueOnce(' M src/file.ts\n'); // git status --porcelain (has changes)

      const { runFocusedTask } = await import('./focus-runner.js');

      runFocusedTask({ task: 'test' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('uncommitted changes');
    });

    it('should exit with non-zero status on turbo failure', async () => {
      mockExecSync.mockImplementation(() => {
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
      mockExecSync.mockImplementation(() => {
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
  });
});
