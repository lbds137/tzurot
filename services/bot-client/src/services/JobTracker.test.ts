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

  describe('Taking-longer notification (5 min)', () => {
    it('should send notification once the job exceeds TAKING_LONGER_NOTIFY_MS (5 min)', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue({ id: 'notif-1', delete: vi.fn() }),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());
      await vi.advanceTimersByTimeAsync(0);

      // Before 5 min: no notification yet
      await vi.advanceTimersByTimeAsync(4 * 60 * 1000 + 56 * 1000); // 4:56
      expect(mockChannel.send).not.toHaveBeenCalled();

      // Past 5 min: notification fires on next interval tick
      await vi.advanceTimersByTimeAsync(16 * 1000); // -> ~5:12
      expect(mockChannel.send).toHaveBeenCalledWith(
        expect.stringContaining('⏱️ This is taking longer than expected')
      );

      // Typing should STILL be firing (typing cutoff is 10 min, decoupled now)
      const typingCallsAfterNotify = mockChannel.sendTyping.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(mockChannel.sendTyping.mock.calls.length).toBeGreaterThan(typingCallsAfterNotify);

      // Job still tracked
      expect(jobTracker.isTracking('job-123')).toBe(true);
    });

    it('should not re-send the notification on subsequent interval ticks', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue({ id: 'notif-1', delete: vi.fn() }),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

      // Advance past 5 min plus several additional ticks
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);

      expect(mockChannel.send).toHaveBeenCalledTimes(1);
    });

    it('should handle notification send failures gracefully', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockRejectedValue(new Error('Channel deleted')),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 16 * 1000);

      expect(mockChannel.send).toHaveBeenCalled();
      expect(jobTracker.isTracking('job-123')).toBe(true); // not unregistered
    });

    it('should delete the notification message on job completion', async () => {
      const deleteMock = vi.fn().mockResolvedValue(undefined);
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue({ id: 'notif-1', delete: deleteMock }),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

      // Trigger notification
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 16 * 1000);
      expect(mockChannel.send).toHaveBeenCalledTimes(1);

      // Complete the job — the "taking longer" message should be deleted
      jobTracker.completeJob('job-123');
      expect(deleteMock).toHaveBeenCalledTimes(1);
    });

    it('should swallow delete failures on completion (Discord 404/429 safe)', async () => {
      const deleteMock = vi.fn().mockRejectedValue(new Error('Unknown Message'));
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue({ id: 'notif-1', delete: deleteMock }),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 16 * 1000);

      // Must not throw — delete failure is silent-swallow per design
      expect(() => jobTracker.completeJob('job-123')).not.toThrow();
      expect(deleteMock).toHaveBeenCalled();
    });

    it('should not attempt delete when notification was never sent', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn(),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());
      // Complete quickly — no notification should have fired
      await vi.advanceTimersByTimeAsync(30 * 1000);

      jobTracker.completeJob('job-123');
      expect(mockChannel.send).not.toHaveBeenCalled();
    });

    it('should delete the notification immediately if job completes during the send', async () => {
      // Race-condition guard: between `tracked.notificationSent = true` and
      // `tracked.takingLongerMessage = notification` there's an `await` on
      // `channel.send()`. If completeJob fires during that window, the job
      // is removed from activeJobs but takingLongerMessage is still
      // undefined, so completeJob skips the delete. Without the race guard
      // in trackJob, the notification would leak.
      const deleteMock = vi.fn().mockResolvedValue(undefined);
      let resolveSend: (msg: unknown) => void = () => {};
      const pendingSend = new Promise(resolve => {
        resolveSend = resolve;
      });
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockReturnValue(pendingSend),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

      // Advance past 5 min — notification send is fired but still pending.
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 16 * 1000);
      expect(mockChannel.send).toHaveBeenCalledTimes(1);

      // While the send is in flight, complete the job. completeJob reads
      // takingLongerMessage === undefined and does not delete anything.
      jobTracker.completeJob('job-123');
      expect(deleteMock).not.toHaveBeenCalled();

      // Now resolve the pending send. The interval callback detects that the
      // job is no longer tracked and must delete the now-orphaned notification
      // directly.
      resolveSend({ id: 'notif-1', delete: deleteMock });
      await vi.advanceTimersByTimeAsync(0); // flush microtasks

      expect(deleteMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('Typing indicator cutoff (10 min)', () => {
    it('should stop typing after TYPING_INDICATOR_TIMEOUT_MS, keep job tracked', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi.fn().mockResolvedValue({ id: 'notif-1', delete: vi.fn() }),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

      // Advance past 10 min typing cutoff
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 16 * 1000);

      const typingCallsAfterCutoff = mockChannel.sendTyping.mock.calls.length;
      await vi.advanceTimersByTimeAsync(60 * 1000);

      // Typing stopped — no new calls
      expect(mockChannel.sendTyping).toHaveBeenCalledTimes(typingCallsAfterCutoff);
      // Job still tracked for result delivery
      expect(jobTracker.isTracking('job-123')).toBe(true);
    });
  });

  describe('Orphan sweep (grace period past typing cutoff)', () => {
    it('should release the tracker if the result never arrives past grace period', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi
          .fn()
          .mockResolvedValue({ id: 'notif-1', delete: vi.fn().mockResolvedValue(undefined) }),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

      // Advance just past the typing cutoff — orphan sweep is armed here.
      // +16s = 2 typing-interval (8s) ticks past the 10-min cutoff so the
      // interval callback actually fires and runs the cutoff branch.
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 16 * 1000);
      expect(jobTracker.isTracking('job-123')).toBe(true);

      // Advance another 29 min — still inside grace period, job still tracked.
      await vi.advanceTimersByTimeAsync(29 * 60 * 1000);
      expect(jobTracker.isTracking('job-123')).toBe(true);

      // Advance past the 30-min grace period — sweep fires, tracker released.
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(jobTracker.isTracking('job-123')).toBe(false);
    });

    it('should not fire if the job completes normally before grace period', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi
          .fn()
          .mockResolvedValue({ id: 'notif-1', delete: vi.fn().mockResolvedValue(undefined) }),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

      // Advance past typing cutoff so the sweep is armed.
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 16 * 1000);
      expect(jobTracker.isTracking('job-123')).toBe(true);

      // Result lands 15 min later (inside grace period).
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      const channel = jobTracker.completeJob('job-123');
      expect(channel).toBe(mockChannel);
      expect(jobTracker.isTracking('job-123')).toBe(false);

      // Advance past when the sweep would have fired — must not re-invoke
      // completeJob or warn. Re-completing an unknown job would return null,
      // so this primarily guards against the sweep timer firing with stale
      // closure state.
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(jobTracker.isTracking('job-123')).toBe(false);
    });

    it('should clear pending orphan sweeps on cleanup()', async () => {
      const mockChannel = {
        id: 'channel-123',
        sendTyping: vi.fn().mockResolvedValue(undefined),
        send: vi
          .fn()
          .mockResolvedValue({ id: 'notif-1', delete: vi.fn().mockResolvedValue(undefined) }),
      } as any;

      jobTracker.trackJob('job-123', mockChannel, createMockContext());

      // Arm the sweep by passing typing cutoff.
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 16 * 1000);
      expect(jobTracker.isTracking('job-123')).toBe(true);

      // Shutdown clears everything, including the pending sweep.
      jobTracker.cleanup();
      expect(jobTracker.isTracking('job-123')).toBe(false);

      // Advancing past the sweep's scheduled fire time must not re-invoke
      // any side effects — the timer was cleared.
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      expect(jobTracker.isTracking('job-123')).toBe(false);
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
