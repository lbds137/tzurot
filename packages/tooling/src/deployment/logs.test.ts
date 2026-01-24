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
  execSync: vi.fn().mockReturnValue('authenticated'),
  spawn: vi.fn(),
}));

// Mock env-runner
vi.mock('../utils/env-runner.js', () => ({
  checkRailwayCli: vi.fn().mockReturnValue(true),
  getRailwayEnvName: vi.fn((env: string) => (env === 'dev' ? 'development' : 'production')),
}));

import { execFileSync } from 'node:child_process';
import { fetchLogs } from './logs.js';

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

  describe('log filtering', () => {
    it('should filter logs by keyword', async () => {
      vi.mocked(execFileSync).mockReturnValue(
        '2024-01-24 10:00:00 Request received\n' +
          '2024-01-24 10:00:01 Database connection failed\n' +
          '2024-01-24 10:00:02 Another message\n'
      );

      await fetchLogs({ env: 'dev', filter: 'database' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Database connection failed');
      expect(output).not.toContain('Request received');
    });

    it('should filter by log level (JSON format)', async () => {
      vi.mocked(execFileSync).mockReturnValue(
        '{"level":"info","message":"Info log"}\n{"level":"error","message":"Error log"}\n'
      );

      await fetchLogs({ env: 'dev', filter: 'error' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('Error log');
      expect(output).not.toContain('Info log');
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
});
