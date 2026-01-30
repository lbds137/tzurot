/**
 * VerificationCleanupScheduler Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startVerificationCleanupScheduler,
  stopVerificationCleanupScheduler,
} from './VerificationCleanupScheduler.js';

// Mock dependencies
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal();
  return {
    ...(actual as Record<string, unknown>),
    createLogger: () => ({
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    }),
  };
});

const mockCleanupService = {
  cleanupExpiredMessages: vi.fn(),
};

vi.mock('./VerificationCleanupService.js', () => ({
  getVerificationCleanupService: () => mockCleanupService,
}));

describe('VerificationCleanupScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mockCleanupService.cleanupExpiredMessages.mockResolvedValue({
      processed: 0,
      deleted: 0,
      failed: 0,
    });
  });

  afterEach(() => {
    // Always stop scheduler to clean up intervals
    stopVerificationCleanupScheduler();
    vi.useRealTimers();
  });

  describe('startVerificationCleanupScheduler', () => {
    it('should run cleanup after initial delay', async () => {
      startVerificationCleanupScheduler();

      // Advance past the 30 second initial delay
      await vi.advanceTimersByTimeAsync(30000);

      expect(mockCleanupService.cleanupExpiredMessages).toHaveBeenCalledTimes(1);
    });

    it('should run cleanup periodically (every 6 hours)', async () => {
      startVerificationCleanupScheduler();

      // Skip initial delay
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockCleanupService.cleanupExpiredMessages).toHaveBeenCalledTimes(1);

      // Advance 6 hours
      const sixHoursMs = 6 * 60 * 60 * 1000;
      await vi.advanceTimersByTimeAsync(sixHoursMs);
      expect(mockCleanupService.cleanupExpiredMessages).toHaveBeenCalledTimes(2);

      // Advance another 6 hours
      await vi.advanceTimersByTimeAsync(sixHoursMs);
      expect(mockCleanupService.cleanupExpiredMessages).toHaveBeenCalledTimes(3);
    });

    it('should not start duplicate schedulers', async () => {
      startVerificationCleanupScheduler();
      startVerificationCleanupScheduler(); // Second call should be ignored

      // Advance past initial delay
      await vi.advanceTimersByTimeAsync(30000);

      // Should only run once (not twice from duplicate schedulers)
      expect(mockCleanupService.cleanupExpiredMessages).toHaveBeenCalledTimes(1);
    });

    it('should handle cleanup errors gracefully', async () => {
      mockCleanupService.cleanupExpiredMessages.mockRejectedValueOnce(new Error('Cleanup failed'));

      startVerificationCleanupScheduler();

      // Advance past initial delay - should not throw
      await vi.advanceTimersByTimeAsync(30000);

      expect(mockCleanupService.cleanupExpiredMessages).toHaveBeenCalledTimes(1);
    });

    it('should log when messages are processed', async () => {
      mockCleanupService.cleanupExpiredMessages.mockResolvedValueOnce({
        processed: 5,
        deleted: 3,
        failed: 2,
      });

      startVerificationCleanupScheduler();

      // Advance past initial delay
      await vi.advanceTimersByTimeAsync(30000);

      expect(mockCleanupService.cleanupExpiredMessages).toHaveBeenCalledTimes(1);
    });
  });

  describe('stopVerificationCleanupScheduler', () => {
    it('should stop the cleanup interval', async () => {
      startVerificationCleanupScheduler();

      // Advance past initial delay
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockCleanupService.cleanupExpiredMessages).toHaveBeenCalledTimes(1);

      // Stop the scheduler
      stopVerificationCleanupScheduler();

      // Advance 6 hours - should not trigger cleanup
      const sixHoursMs = 6 * 60 * 60 * 1000;
      await vi.advanceTimersByTimeAsync(sixHoursMs);
      expect(mockCleanupService.cleanupExpiredMessages).toHaveBeenCalledTimes(1);
    });

    it('should handle being called when not running', () => {
      // Should not throw
      expect(() => stopVerificationCleanupScheduler()).not.toThrow();
    });

    it('should allow restarting after stop', async () => {
      startVerificationCleanupScheduler();
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockCleanupService.cleanupExpiredMessages).toHaveBeenCalledTimes(1);

      stopVerificationCleanupScheduler();

      // Restart
      startVerificationCleanupScheduler();
      await vi.advanceTimersByTimeAsync(30000);
      expect(mockCleanupService.cleanupExpiredMessages).toHaveBeenCalledTimes(2);
    });
  });
});
