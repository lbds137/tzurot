/**
 * JobTracker Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JobTracker } from '../../../src/services/JobTracker.js';

describe('JobTracker', () => {
  let jobTracker: JobTracker;

  beforeEach(() => {
    vi.useFakeTimers();
    jobTracker = new JobTracker();
  });

  afterEach(() => {
    jobTracker.cleanup();
    vi.restoreAllMocks();
  });

  describe('trackJob', () => {
    it('should track a new job and start typing indicator', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      jobTracker.trackJob('job-123', mockChannel);

      // Initial typing should be sent immediately
      await vi.advanceTimersByTimeAsync(0);
      expect(mockChannel.sendTyping).toHaveBeenCalledTimes(1);

      // Typing should refresh every 8 seconds
      await vi.advanceTimersByTimeAsync(8000);
      expect(mockChannel.sendTyping).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(8000);
      expect(mockChannel.sendTyping).toHaveBeenCalledTimes(3);
    });

    it('should handle sendTyping errors gracefully', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockRejectedValue(new Error('Channel deleted')),
      } as any;

      // Should not throw
      jobTracker.trackJob('job-123', mockChannel);

      // Wait for initial typing
      await vi.advanceTimersByTimeAsync(0);

      // Should still be tracking
      const channel = jobTracker.completeJob('job-123');
      expect(channel).toBe(mockChannel);
    });
  });

  describe('completeJob', () => {
    it('should return channel and stop typing indicator', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      jobTracker.trackJob('job-123', mockChannel);

      // Initial typing sent
      await vi.advanceTimersByTimeAsync(0);
      expect(mockChannel.sendTyping).toHaveBeenCalledTimes(1);

      // Complete the job
      const channel = jobTracker.completeJob('job-123');
      expect(channel).toBe(mockChannel);

      // Typing should stop
      await vi.advanceTimersByTimeAsync(8000);
      expect(mockChannel.sendTyping).toHaveBeenCalledTimes(1); // No more calls
    });

    it('should return null for unknown job', () => {
      const channel = jobTracker.completeJob('unknown-job');
      expect(channel).toBeNull();
    });

    it('should allow completing same job multiple times (idempotent)', () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      jobTracker.trackJob('job-123', mockChannel);

      const channel1 = jobTracker.completeJob('job-123');
      expect(channel1).toBe(mockChannel);

      const channel2 = jobTracker.completeJob('job-123');
      expect(channel2).toBeNull(); // Already completed
    });
  });

  describe('cleanup', () => {
    it('should clear all typing intervals', async () => {
      const mockChannel1 = {
        id: 'channel-1',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      const mockChannel2 = {
        id: 'channel-2',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      jobTracker.trackJob('job-1', mockChannel1);
      jobTracker.trackJob('job-2', mockChannel2);

      // Initial typing for both
      await vi.advanceTimersByTimeAsync(0);
      expect(mockChannel1.sendTyping).toHaveBeenCalledTimes(1);
      expect(mockChannel2.sendTyping).toHaveBeenCalledTimes(1);

      // Cleanup
      jobTracker.cleanup();

      // No more typing after cleanup
      await vi.advanceTimersByTimeAsync(8000);
      expect(mockChannel1.sendTyping).toHaveBeenCalledTimes(1);
      expect(mockChannel2.sendTyping).toHaveBeenCalledTimes(1);
    });
  });
});
