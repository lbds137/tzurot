import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';

/**
 * Queue inspection tests
 *
 * Note: BullMQ mocking is complex due to closure capture at import time.
 * These tests focus on exports and error handling. Full queue behavior
 * is verified through manual testing against actual Redis.
 */

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

// Simple queue mock - returns empty stats
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    getJobCounts: vi.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 0,
      failed: 0,
      delayed: 0,
      paused: 0,
    }),
    getFailed: vi.fn().mockResolvedValue([]),
    getActive: vi.fn().mockResolvedValue([]),
    close: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('@tzurot/common-types', () => ({
  parseRedisUrl: vi.fn(() => ({ host: 'localhost', port: 6379 })),
  createBullMQRedisConfig: vi.fn(config => ({ ...config, maxRetriesPerRequest: null })),
}));

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn().mockReturnValue(JSON.stringify({ REDIS_URL: 'redis://localhost:6379' })),
}));

import { inspectQueue } from './queue.js';

describe('inspectQueue', () => {
  let consoleLogSpy: MockInstance;
  let consoleErrorSpy: MockInstance;
  let originalExitCode: typeof process.exitCode;
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    originalExitCode = process.exitCode;
    process.exitCode = undefined;
    originalEnv = { ...process.env };
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    process.exitCode = originalExitCode;
    process.env = originalEnv;
  });

  it('should export inspectQueue function', () => {
    expect(typeof inspectQueue).toBe('function');
  });

  describe('basic output', () => {
    it('should display queue name', async () => {
      await inspectQueue({ env: 'local' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('ai-requests');
    });

    it('should display environment', async () => {
      await inspectQueue({ env: 'local' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('local');
    });

    it('should use custom queue name', async () => {
      await inspectQueue({ env: 'local', queue: 'my-custom-queue' });

      const output = consoleLogSpy.mock.calls.flat().join(' ');
      expect(output).toContain('my-custom-queue');
    });

    // Note: Queue stats display depends on BullMQ mock chain which is
    // difficult to test reliably. Full behavior verified manually.
  });

  describe('Railway environment', () => {
    it('should use Railway CLI for dev environment', async () => {
      delete process.env.REDIS_URL;
      const childProcess = await import('node:child_process');

      await inspectQueue({ env: 'dev' });

      expect(childProcess.execFileSync).toHaveBeenCalled();
    });

    it('should handle missing Redis URL gracefully', async () => {
      delete process.env.REDIS_URL;
      const childProcess = await import('node:child_process');
      (childProcess.execFileSync as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error('Not logged in');
      });

      await inspectQueue({ env: 'dev' });

      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
    });
  });
});
