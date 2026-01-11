/**
 * Tests for test-summary
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Track mock state
const mockSpawnSync = vi.fn();

// Mock child_process
vi.mock('node:child_process', () => ({
  spawnSync: mockSpawnSync,
}));

describe('test-summary', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let processExitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();

    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    processExitSpy.mockRestore();
  });

  describe('runTestSummary', () => {
    it('should export runTestSummary function', async () => {
      const module = await import('./test-summary.js');
      expect(typeof module.runTestSummary).toBe('function');
    });

    it('should run turbo test command', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        pid: 123,
        output: ['', 'Test Files  1 passed (1)\nTests  5 passed (5)', ''],
        stdout:
          '@tzurot/common-types:test: Test Files  1 passed (1)\n@tzurot/common-types:test: Tests  5 passed (5)',
        stderr: '',
      });

      const { runTestSummary } = await import('./test-summary.js');

      runTestSummary();

      expect(mockSpawnSync).toHaveBeenCalledWith(
        'turbo',
        ['run', 'test'],
        expect.objectContaining({ encoding: 'utf-8' })
      );
    });

    it('should exit with 0 on successful tests', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        pid: 123,
        output: ['', '', ''],
        stdout:
          '@tzurot/api-gateway:test: Test Files  5 passed (5)\n@tzurot/api-gateway:test: Tests  25 passed (25)',
        stderr: '',
      });

      const { runTestSummary } = await import('./test-summary.js');

      runTestSummary();

      expect(processExitSpy).toHaveBeenCalledWith(0);
    });

    it('should exit with non-zero on test failure', async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        signal: null,
        pid: 123,
        output: ['', '', ''],
        stdout:
          '@tzurot/bot-client:test: Test Files  1 failed | 5 passed (6)\n@tzurot/bot-client:test: Tests  2 failed | 50 passed (52)',
        stderr: '',
      });

      const { runTestSummary } = await import('./test-summary.js');

      runTestSummary();

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle spawn error', async () => {
      mockSpawnSync.mockReturnValue({
        status: null,
        signal: null,
        pid: 123,
        output: [],
        stdout: '',
        stderr: '',
        error: new Error('turbo not found'),
      });

      const { runTestSummary } = await import('./test-summary.js');

      runTestSummary();

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should display test summary header', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        pid: 123,
        output: ['', '', ''],
        stdout:
          '@tzurot/tooling:test: Test Files  3 passed (3)\n@tzurot/tooling:test: Tests  10 passed (10)',
        stderr: '',
      });

      const { runTestSummary } = await import('./test-summary.js');

      runTestSummary();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('TEST SUMMARY');
    });

    it('should group results by package', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        pid: 123,
        output: ['', '', ''],
        stdout: [
          '@tzurot/api-gateway:test: Test Files  5 passed (5)',
          '@tzurot/api-gateway:test: Tests  25 passed (25)',
          '@tzurot/bot-client:test: Test Files  3 passed (3)',
          '@tzurot/bot-client:test: Tests  15 passed (15)',
        ].join('\n'),
        stderr: '',
      });

      const { runTestSummary } = await import('./test-summary.js');

      runTestSummary();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('api-gateway');
      expect(output).toContain('bot-client');
    });

    it('should show failure hint when tests fail', async () => {
      mockSpawnSync.mockReturnValue({
        status: 1,
        signal: null,
        pid: 123,
        output: ['', '', ''],
        stdout:
          '@tzurot/ai-worker:test: Test Files  1 failed | 10 passed (11)\n@tzurot/ai-worker:test: Tests  1 failed | 100 passed (101)',
        stderr: '',
      });

      const { runTestSummary } = await import('./test-summary.js');

      runTestSummary();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('test:failures');
    });

    it('should handle empty output gracefully', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        pid: 123,
        output: ['', '', ''],
        stdout: '',
        stderr: '',
      });

      const { runTestSummary } = await import('./test-summary.js');

      runTestSummary();

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('No test results found');
    });

    it('should handle null stdout/stderr', async () => {
      mockSpawnSync.mockReturnValue({
        status: 0,
        signal: null,
        pid: 123,
        output: [],
        stdout: null as unknown as string,
        stderr: null as unknown as string,
      });

      const { runTestSummary } = await import('./test-summary.js');

      // Should not throw
      expect(() => runTestSummary()).not.toThrow();
    });
  });
});
