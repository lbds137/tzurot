/**
 * JobTracker Unit Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JobTracker, type PendingJobContext } from './JobTracker.js';

// Helper to create mock context
function createMockContext(): PendingJobContext {
  return {
    message: { id: 'msg-123' } as any,
    personality: { id: 'pers-123', displayName: 'Test' } as any,
    personaId: 'persona-123',
    userMessageContent: 'test message',
    userMessageTime: new Date(),
  };
}

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

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

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
      jobTracker.trackJob('job-123', mockChannel, createMockContext());

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

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

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

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

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

      jobTracker.trackJob('job-1', mockChannel1, createMockContext());
      jobTracker.trackJob('job-2', mockChannel2, createMockContext());

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

  describe('Job timeout handling', () => {
    it('should send timeout notification and stop typing after MAX_JOB_AGE (10 minutes)', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue(undefined),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

      // Initial typing
      await vi.advanceTimersByTimeAsync(0);
      expect(mockChannel.sendTyping).toHaveBeenCalledTimes(1);

      // Advance to just before timeout (9 minutes 52 seconds - last interval before 10 min)
      await vi.advanceTimersByTimeAsync(9 * 60 * 1000 + 52 * 1000);

      // Should still be sending typing indicators
      const typingCallsBeforeTimeout = mockChannel.sendTyping.mock.calls.length;
      expect(typingCallsBeforeTimeout).toBeGreaterThan(1);

      // Advance past 10 minute timeout to next interval (10 min 8 sec total)
      // Interval fires at 8s intervals: 592s, 600s, 608s
      // At 608s (10:08), age > 600000ms, so timeout triggers
      await vi.advanceTimersByTimeAsync(16 * 1000);

      // Should have sent timeout notification
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('⏱️ This is taking longer than expected')
      );

      // Typing should stop after timeout
      const typingCallsAfterTimeout = mockChannel.sendTyping.mock.calls.length;

      // Advance more time - typing should NOT continue
      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(mockChannel.sendTyping).toHaveBeenCalledTimes(typingCallsAfterTimeout);

      // Job should still be tracked for result delivery
      expect(jobTracker.isTracking('job-123')).toBe(true);
      const context = jobTracker.getContext('job-123');
      expect(context).not.toBeNull();
    });

    it('should handle timeout notification send failures gracefully', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockRejectedValue(new Error('Channel deleted')),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 8000);

      // Should have attempted to send notification (but it failed)
      expect(mockChannel.send).toHaveBeenCalled();

      // Job should still be tracked despite notification failure
      expect(jobTracker.isTracking('job-123')).toBe(true);
    });
  });

  describe('isTracking', () => {
    it('should return true for tracked jobs', () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      expect(jobTracker.isTracking('job-123')).toBe(false);

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

      expect(jobTracker.isTracking('job-123')).toBe(true);
    });

    it('should return false after job completion', () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());
      expect(jobTracker.isTracking('job-123')).toBe(true);

      jobTracker.completeJob('job-123');
      expect(jobTracker.isTracking('job-123')).toBe(false);
    });
  });

  describe('getContext', () => {
    it('should return context for tracked jobs', () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      const context = createMockContext();
      jobTracker.trackJob('job-123', mockChannel, context);

      const retrieved = jobTracker.getContext('job-123');
      expect(retrieved).toBe(context);
      expect(retrieved?.personaId).toBe('persona-123');
    });

    it('should return null for untracked jobs', () => {
      const context = jobTracker.getContext('unknown-job');
      expect(context).toBeNull();
    });

    it('should return null after job completion', () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());
      jobTracker.completeJob('job-123');

      const context = jobTracker.getContext('job-123');
      expect(context).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return zero stats when no jobs tracked', () => {
      const stats = jobTracker.getStats();

      expect(stats.activeJobs).toBe(0);
      expect(stats.oldestJobAge).toBeNull();
    });

    it('should return correct active job count', async () => {
      const mockChannel1 = {
        id: 'channel-1',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      const mockChannel2 = {
        id: 'channel-2',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      jobTracker.trackJob('job-1', mockChannel1, createMockContext());

      await vi.advanceTimersByTimeAsync(100);

      jobTracker.trackJob('job-2', mockChannel2, createMockContext());

      const stats = jobTracker.getStats();
      expect(stats.activeJobs).toBe(2);
    });

    it('should calculate oldest job age correctly', async () => {
      const mockChannel = {
        id: 'channel-1',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      jobTracker.trackJob('job-1', mockChannel, createMockContext());

      // Advance 5 minutes
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

      const stats = jobTracker.getStats();
      expect(stats.activeJobs).toBe(1);
      expect(stats.oldestJobAge).toBeGreaterThanOrEqual(5 * 60 * 1000);
      expect(stats.oldestJobAge).toBeLessThan(5 * 60 * 1000 + 1000);
    });

    it('should track oldest job when multiple jobs exist', async () => {
      const mockChannel1 = {
        id: 'channel-1',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      const mockChannel2 = {
        id: 'channel-2',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      // Start first job
      jobTracker.trackJob('job-1', mockChannel1, createMockContext());

      // Wait 3 minutes
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

      // Start second job
      jobTracker.trackJob('job-2', mockChannel2, createMockContext());

      // Wait another 2 minutes
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

      const stats = jobTracker.getStats();
      expect(stats.activeJobs).toBe(2);
      // Oldest job (job-1) should be ~5 minutes old
      expect(stats.oldestJobAge).toBeGreaterThanOrEqual(5 * 60 * 1000);
      expect(stats.oldestJobAge).toBeLessThan(5 * 60 * 1000 + 1000);
    });

    it('should update stats after job completion', async () => {
      const mockChannel1 = {
        id: 'channel-1',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      const mockChannel2 = {
        id: 'channel-2',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      jobTracker.trackJob('job-1', mockChannel1, createMockContext());
      jobTracker.trackJob('job-2', mockChannel2, createMockContext());

      expect(jobTracker.getStats().activeJobs).toBe(2);

      jobTracker.completeJob('job-1');

      expect(jobTracker.getStats().activeJobs).toBe(1);

      jobTracker.completeJob('job-2');

      const stats = jobTracker.getStats();
      expect(stats.activeJobs).toBe(0);
      expect(stats.oldestJobAge).toBeNull();
    });
  });

  describe('Re-tracking same jobId', () => {
    it('should clear old tracker when tracking same jobId again', async () => {
      const mockChannel1 = {
        id: 'channel-1',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      const mockChannel2 = {
        id: 'channel-2',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      const context1 = createMockContext();
      const context2 = { ...createMockContext(), personaId: 'different-persona' };

      // Track job first time
      jobTracker.trackJob('job-123', mockChannel1, context1);

      await vi.advanceTimersByTimeAsync(0);
      expect(mockChannel1.sendTyping).toHaveBeenCalled();

      // Track same jobId again (shouldn't happen, but handled gracefully)
      jobTracker.trackJob('job-123', mockChannel2, context2);

      // Old channel should have stopped typing
      const oldChannelCalls = mockChannel1.sendTyping.mock.calls.length;
      await vi.advanceTimersByTimeAsync(8000);
      expect(mockChannel1.sendTyping).toHaveBeenCalledTimes(oldChannelCalls);

      // New channel should be active
      expect(mockChannel2.sendTyping).toHaveBeenCalled();

      // Context should be from second tracking
      const retrievedContext = jobTracker.getContext('job-123');
      expect(retrievedContext?.personaId).toBe('different-persona');
    });
  });

  describe('Concurrent jobs', () => {
    it('should handle multiple concurrent jobs independently', async () => {
      const mockChannel1 = {
        id: 'channel-1',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      const mockChannel2 = {
        id: 'channel-2',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      const mockChannel3 = {
        id: 'channel-3',
        sendTyping: vi.fn().mockResolvedValue(undefined),
      } as any;

      // Start three jobs at different times
      jobTracker.trackJob('job-1', mockChannel1, createMockContext());

      await vi.advanceTimersByTimeAsync(1000);
      jobTracker.trackJob('job-2', mockChannel2, createMockContext());

      await vi.advanceTimersByTimeAsync(1000);
      jobTracker.trackJob('job-3', mockChannel3, createMockContext());

      // All should be tracked
      expect(jobTracker.isTracking('job-1')).toBe(true);
      expect(jobTracker.isTracking('job-2')).toBe(true);
      expect(jobTracker.isTracking('job-3')).toBe(true);

      // Complete job-2
      jobTracker.completeJob('job-2');

      // Job-2 should be gone
      expect(jobTracker.isTracking('job-2')).toBe(false);

      // Others should still be active
      expect(jobTracker.isTracking('job-1')).toBe(true);
      expect(jobTracker.isTracking('job-3')).toBe(true);

      // Stats should reflect this
      const stats = jobTracker.getStats();
      expect(stats.activeJobs).toBe(2);
    });
  });
});
