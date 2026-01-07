/**
 * Tests for ResponseOrderingService
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ResponseOrderingService } from './ResponseOrderingService.js';
import type { LLMGenerationResult } from '@tzurot/common-types';

describe('ResponseOrderingService', () => {
  let service: ResponseOrderingService;
  let deliveredResults: Array<{ jobId: string; result: LLMGenerationResult }>;
  let deliverFn: (jobId: string, result: LLMGenerationResult) => Promise<void>;

  // Helper to create mock results
  const createResult = (content: string): LLMGenerationResult => ({
    success: true,
    content,
    metadata: { modelUsed: 'test-model' },
  });

  beforeEach(() => {
    // Explicitly configure fake timers to include Date and set a fixed start time
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
    service = new ResponseOrderingService();
    deliveredResults = [];
    deliverFn = vi.fn(async (jobId, result) => {
      deliveredResults.push({ jobId, result });
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('registerJob', () => {
    it('should register a job without error', () => {
      const channelId = 'channel-1';
      const jobId = 'job-1';
      const userMessageTime = new Date('2024-01-01T10:00:00Z');

      expect(() => service.registerJob(channelId, jobId, userMessageTime)).not.toThrow();

      const stats = service.getStats();
      expect(stats.channelCount).toBe(1);
      expect(stats.totalPending).toBe(1);
    });

    it('should register multiple jobs in same channel', () => {
      const channelId = 'channel-1';

      service.registerJob(channelId, 'job-1', new Date('2024-01-01T10:00:00Z'));
      service.registerJob(channelId, 'job-2', new Date('2024-01-01T10:01:00Z'));
      service.registerJob(channelId, 'job-3', new Date('2024-01-01T10:02:00Z'));

      const stats = service.getStats();
      expect(stats.channelCount).toBe(1);
      expect(stats.totalPending).toBe(3);
    });

    it('should register jobs in different channels independently', () => {
      service.registerJob('channel-1', 'job-1', new Date('2024-01-01T10:00:00Z'));
      service.registerJob('channel-2', 'job-2', new Date('2024-01-01T10:00:00Z'));

      const stats = service.getStats();
      expect(stats.channelCount).toBe(2);
      expect(stats.totalPending).toBe(2);
    });
  });

  describe('handleResult - sequential delivery', () => {
    it('should deliver immediately when no other jobs pending', async () => {
      const channelId = 'channel-1';
      const jobId = 'job-1';
      const userMessageTime = new Date('2024-01-01T10:00:00Z');

      service.registerJob(channelId, jobId, userMessageTime);
      await service.handleResult(
        channelId,
        jobId,
        createResult('Hello'),
        userMessageTime,
        deliverFn
      );

      expect(deliveredResults).toHaveLength(1);
      expect(deliveredResults[0].jobId).toBe(jobId);
      expect(deliveredResults[0].result.content).toBe('Hello');
    });

    it('should deliver in request order when results arrive in order', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');
      const time3 = new Date('2024-01-01T10:02:00Z');

      // Register jobs in order
      service.registerJob(channelId, 'job-1', time1);
      service.registerJob(channelId, 'job-2', time2);
      service.registerJob(channelId, 'job-3', time3);

      // Results arrive in order
      await service.handleResult(channelId, 'job-1', createResult('First'), time1, deliverFn);
      await service.handleResult(channelId, 'job-2', createResult('Second'), time2, deliverFn);
      await service.handleResult(channelId, 'job-3', createResult('Third'), time3, deliverFn);

      expect(deliveredResults).toHaveLength(3);
      expect(deliveredResults[0].result.content).toBe('First');
      expect(deliveredResults[1].result.content).toBe('Second');
      expect(deliveredResults[2].result.content).toBe('Third');
    });
  });

  describe('handleResult - out-of-order completion', () => {
    it('should buffer result when older job is still pending', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');

      // Register both jobs
      service.registerJob(channelId, 'job-1', time1);
      service.registerJob(channelId, 'job-2', time2);

      // Job 2 (newer) completes first
      await service.handleResult(channelId, 'job-2', createResult('Second'), time2, deliverFn);

      // Should be buffered, not delivered yet
      expect(deliveredResults).toHaveLength(0);

      const stats = service.getStats();
      expect(stats.totalBuffered).toBe(1);
    });

    it('should deliver buffered result when predecessor completes', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');

      // Register both jobs
      service.registerJob(channelId, 'job-1', time1);
      service.registerJob(channelId, 'job-2', time2);

      // Job 2 (newer) completes first - buffered
      await service.handleResult(channelId, 'job-2', createResult('Second'), time2, deliverFn);
      expect(deliveredResults).toHaveLength(0);

      // Job 1 (older) completes - both should deliver in order
      await service.handleResult(channelId, 'job-1', createResult('First'), time1, deliverFn);

      expect(deliveredResults).toHaveLength(2);
      expect(deliveredResults[0].result.content).toBe('First');
      expect(deliveredResults[1].result.content).toBe('Second');
    });

    it('should handle 3 jobs completing in reverse order', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');
      const time3 = new Date('2024-01-01T10:02:00Z');

      // Register jobs in order
      service.registerJob(channelId, 'job-1', time1);
      service.registerJob(channelId, 'job-2', time2);
      service.registerJob(channelId, 'job-3', time3);

      // Results arrive in reverse order
      await service.handleResult(channelId, 'job-3', createResult('Third'), time3, deliverFn);
      expect(deliveredResults).toHaveLength(0);

      await service.handleResult(channelId, 'job-2', createResult('Second'), time2, deliverFn);
      expect(deliveredResults).toHaveLength(0);

      // First job completes - all should flush in order
      await service.handleResult(channelId, 'job-1', createResult('First'), time1, deliverFn);

      expect(deliveredResults).toHaveLength(3);
      expect(deliveredResults[0].result.content).toBe('First');
      expect(deliveredResults[1].result.content).toBe('Second');
      expect(deliveredResults[2].result.content).toBe('Third');
    });
  });

  describe('multi-channel independence', () => {
    it('should not block results in one channel due to pending job in another', async () => {
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');

      // Register job in channel 1 (older)
      service.registerJob('channel-1', 'job-1', time1);

      // Register and complete job in channel 2 (newer timestamp, but different channel)
      service.registerJob('channel-2', 'job-2', time2);
      await service.handleResult('channel-2', 'job-2', createResult('Channel 2'), time2, deliverFn);

      // Channel 2 result should be delivered immediately
      expect(deliveredResults).toHaveLength(1);
      expect(deliveredResults[0].result.content).toBe('Channel 2');
    });
  });

  describe('timeout handling', () => {
    it('should deliver after timeout even if predecessor never completes', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');

      // Register both jobs
      service.registerJob(channelId, 'job-1', time1);
      service.registerJob(channelId, 'job-2', time2);

      // Job 2 completes first - buffered waiting for job-1
      await service.handleResult(channelId, 'job-2', createResult('Second'), time2, deliverFn);
      expect(deliveredResults).toHaveLength(0);
      expect(service.getStats().totalBuffered).toBe(1);

      // Advance time past timeout (10 minutes = 600000ms, + buffer)
      vi.advanceTimersByTime(11 * 60 * 1000); // 660000ms

      // Cancel job-1 to trigger queue reprocessing with the new time
      // (In production, this happens when job-1 times out and returns an error)
      await service.cancelJob(channelId, 'job-1', deliverFn);

      // Job 2 should have been delivered (either due to cancel unblocking or timeout)
      expect(deliveredResults).toHaveLength(1);
      expect(deliveredResults[0].result.content).toBe('Second');
    });

    it('should respect timeout even when triggered by new result', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');
      const time3 = new Date('2024-01-01T10:02:00Z');

      // Register jobs
      service.registerJob(channelId, 'job-1', time1);
      service.registerJob(channelId, 'job-2', time2);

      // Job 2 completes first - buffered
      await service.handleResult(channelId, 'job-2', createResult('Second'), time2, deliverFn);
      expect(deliveredResults).toHaveLength(0);

      // Advance time past timeout (11 minutes > 10 minute MAX_WAIT_MS = 600000ms)
      vi.advanceTimersByTime(11 * 60 * 1000);

      // Register and complete job 3 - this triggers reprocessing
      service.registerJob(channelId, 'job-3', time3);
      await service.handleResult(channelId, 'job-3', createResult('Third'), time3, deliverFn);

      // Job 2 should have been delivered due to timeout (job-1 still pending but timed out)
      expect(deliveredResults.some(r => r.result.content === 'Second')).toBe(true);
    });
  });

  describe('cancelJob', () => {
    it('should unblock buffered results when predecessor is cancelled', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');

      // Register both jobs
      service.registerJob(channelId, 'job-1', time1);
      service.registerJob(channelId, 'job-2', time2);

      // Job 2 completes first - buffered
      await service.handleResult(channelId, 'job-2', createResult('Second'), time2, deliverFn);
      expect(deliveredResults).toHaveLength(0);

      // Cancel job 1 (e.g., it failed)
      await service.cancelJob(channelId, 'job-1', deliverFn);

      // Job 2 should now be delivered
      expect(deliveredResults).toHaveLength(1);
      expect(deliveredResults[0].result.content).toBe('Second');
    });

    it('should handle cancelling non-existent job gracefully', async () => {
      await expect(service.cancelJob('channel-1', 'non-existent')).resolves.toBeUndefined();
    });
  });

  describe('job failure handling', () => {
    it('should deliver failed results in order', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');

      const failedResult: LLMGenerationResult = {
        success: false,
        errorMessage: 'Something went wrong',
      };

      // Register both jobs
      service.registerJob(channelId, 'job-1', time1);
      service.registerJob(channelId, 'job-2', time2);

      // Job 2 completes first (with success)
      await service.handleResult(channelId, 'job-2', createResult('Second'), time2, deliverFn);
      expect(deliveredResults).toHaveLength(0);

      // Job 1 fails - should still be delivered first
      await service.handleResult(channelId, 'job-1', failedResult, time1, deliverFn);

      expect(deliveredResults).toHaveLength(2);
      expect(deliveredResults[0].result.success).toBe(false);
      expect(deliveredResults[1].result.content).toBe('Second');
    });
  });

  describe('same timestamp handling', () => {
    it('should deliver results with same timestamp in arrival order', async () => {
      const channelId = 'channel-1';
      const sameTime = new Date('2024-01-01T10:00:00Z');

      // Two jobs with exact same timestamp
      service.registerJob(channelId, 'job-1', sameTime);
      service.registerJob(channelId, 'job-2', sameTime);

      // Both complete - should deliver in arrival order
      await service.handleResult(channelId, 'job-1', createResult('First'), sameTime, deliverFn);
      await service.handleResult(channelId, 'job-2', createResult('Second'), sameTime, deliverFn);

      expect(deliveredResults).toHaveLength(2);
      // With same timestamp, first registered delivers first
      expect(deliveredResults[0].result.content).toBe('First');
      expect(deliveredResults[1].result.content).toBe('Second');
    });
  });

  describe('delivery failure handling', () => {
    it('should continue processing queue if one delivery fails', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');

      service.registerJob(channelId, 'job-1', time1);
      service.registerJob(channelId, 'job-2', time2);

      let callCount = 0;
      const failingDeliverFn = vi.fn(async (jobId: string, result: LLMGenerationResult) => {
        callCount++;
        if (callCount === 1) {
          throw new Error('Delivery failed');
        }
        deliveredResults.push({ jobId, result });
      });

      // Job 2 completes first (buffered)
      await service.handleResult(
        channelId,
        'job-2',
        createResult('Second'),
        time2,
        failingDeliverFn
      );

      // Job 1 completes - first delivery will fail, but second should succeed
      await service.handleResult(
        channelId,
        'job-1',
        createResult('First'),
        time1,
        failingDeliverFn
      );

      // Despite first failure, second was delivered
      expect(failingDeliverFn).toHaveBeenCalledTimes(2);
      expect(deliveredResults).toHaveLength(1);
      expect(deliveredResults[0].result.content).toBe('Second');
    });
  });

  describe('cleanup', () => {
    it('should clean up channel queue when empty', async () => {
      const channelId = 'channel-1';
      const time = new Date('2024-01-01T10:00:00Z');

      service.registerJob(channelId, 'job-1', time);

      let stats = service.getStats();
      expect(stats.channelCount).toBe(1);

      await service.handleResult(channelId, 'job-1', createResult('Hello'), time, deliverFn);

      stats = service.getStats();
      expect(stats.channelCount).toBe(0);
      expect(stats.totalPending).toBe(0);
      expect(stats.totalBuffered).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should deliver all buffered results on shutdown', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');

      // Register both jobs
      service.registerJob(channelId, 'job-1', time1);
      service.registerJob(channelId, 'job-2', time2);

      // Only job 2 completes - buffered
      await service.handleResult(channelId, 'job-2', createResult('Second'), time2, deliverFn);
      expect(deliveredResults).toHaveLength(0);

      // Shutdown
      await service.shutdown(deliverFn);

      // Buffered result should be delivered
      expect(deliveredResults).toHaveLength(1);
      expect(deliveredResults[0].result.content).toBe('Second');
    });

    it('should deliver shutdown results in order', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');
      const time3 = new Date('2024-01-01T10:02:00Z');

      // Register all jobs but only complete 2 and 3 (reverse order)
      service.registerJob(channelId, 'job-1', time1);
      service.registerJob(channelId, 'job-2', time2);
      service.registerJob(channelId, 'job-3', time3);

      await service.handleResult(channelId, 'job-3', createResult('Third'), time3, deliverFn);
      await service.handleResult(channelId, 'job-2', createResult('Second'), time2, deliverFn);
      expect(deliveredResults).toHaveLength(0);

      // Shutdown
      await service.shutdown(deliverFn);

      // Both should be delivered in order
      expect(deliveredResults).toHaveLength(2);
      expect(deliveredResults[0].result.content).toBe('Second');
      expect(deliveredResults[1].result.content).toBe('Third');
    });

    it('should clear all queues on shutdown', async () => {
      service.registerJob('channel-1', 'job-1', new Date());
      service.registerJob('channel-2', 'job-2', new Date());

      await service.shutdown(deliverFn);

      const stats = service.getStats();
      expect(stats.channelCount).toBe(0);
    });
  });

  describe('unregistered job handling', () => {
    it('should deliver immediately if handleResult called without registerJob (no queue)', async () => {
      const channelId = 'channel-1';
      const time = new Date('2024-01-01T10:00:00Z');

      // No registration, just result
      await service.handleResult(channelId, 'job-1', createResult('Hello'), time, deliverFn);

      expect(deliveredResults).toHaveLength(1);
      expect(deliveredResults[0].result.content).toBe('Hello');
    });

    it('should deliver immediately if handleResult called for unregistered job (queue exists)', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');

      // Register job-1, creating a queue
      service.registerJob(channelId, 'job-1', time1);

      // Call handleResult for job-2 which was never registered
      await service.handleResult(
        channelId,
        'job-2',
        createResult('Unregistered'),
        time2,
        deliverFn
      );

      // Should be delivered immediately (not buffered)
      expect(deliveredResults).toHaveLength(1);
      expect(deliveredResults[0].jobId).toBe('job-2');
      expect(deliveredResults[0].result.content).toBe('Unregistered');
    });
  });

  describe('cleanupStaleJobs', () => {
    it('should not clean up jobs within stale threshold', () => {
      const channelId = 'channel-1';
      const time = new Date('2024-01-01T10:00:00Z');

      service.registerJob(channelId, 'job-1', time);

      // Advance time but stay within threshold (10 min * 1.5 = 15 min)
      vi.advanceTimersByTime(14 * 60 * 1000); // 14 minutes

      const result = service.cleanupStaleJobs();

      expect(result.cleanedCount).toBe(0);
      expect(result.channelsCleaned).toHaveLength(0);
      expect(service.getStats().totalPending).toBe(1);
    });

    it('should clean up jobs past stale threshold', () => {
      const channelId = 'channel-1';
      const time = new Date('2024-01-01T10:00:00Z');

      service.registerJob(channelId, 'job-1', time);

      // Advance time past threshold (10 min * 1.5 = 15 min)
      vi.advanceTimersByTime(16 * 60 * 1000); // 16 minutes

      const result = service.cleanupStaleJobs();

      expect(result.cleanedCount).toBe(1);
      expect(result.channelsCleaned).toContain(channelId);
      expect(service.getStats().totalPending).toBe(0);
    });

    it('should clean up stale jobs from multiple channels', () => {
      const time = new Date('2024-01-01T10:00:00Z');

      service.registerJob('channel-1', 'job-1', time);
      service.registerJob('channel-2', 'job-2', time);
      service.registerJob('channel-3', 'job-3', time);

      // Advance time past threshold
      vi.advanceTimersByTime(16 * 60 * 1000);

      const result = service.cleanupStaleJobs();

      expect(result.cleanedCount).toBe(3);
      expect(result.channelsCleaned).toHaveLength(3);
      expect(service.getStats().channelCount).toBe(0);
    });

    it('should only clean up stale jobs, leaving fresh ones', () => {
      const channelId = 'channel-1';
      const time = new Date('2024-01-01T10:00:00Z');

      // Register old job
      service.registerJob(channelId, 'job-old', time);

      // Advance time past threshold
      vi.advanceTimersByTime(16 * 60 * 1000);

      // Register new job (after advancing time)
      const newTime = new Date('2024-01-01T10:20:00Z');
      service.registerJob(channelId, 'job-new', newTime);

      const result = service.cleanupStaleJobs();

      expect(result.cleanedCount).toBe(1);
      expect(service.getStats().totalPending).toBe(1); // Only new job remains
    });

    it('should clean up channel queue if all jobs are stale', () => {
      const channelId = 'channel-1';
      const time = new Date('2024-01-01T10:00:00Z');

      service.registerJob(channelId, 'job-1', time);

      // Advance time past threshold
      vi.advanceTimersByTime(16 * 60 * 1000);

      service.cleanupStaleJobs();

      // Channel queue should be cleaned up
      expect(service.getStats().channelCount).toBe(0);
    });

    it('should keep channel queue if buffered results remain after cleanup', async () => {
      const channelId = 'channel-1';
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');

      // Register both jobs
      service.registerJob(channelId, 'job-1', time1);
      service.registerJob(channelId, 'job-2', time2);

      // Job-2 completes (buffered waiting for job-1)
      await service.handleResult(channelId, 'job-2', createResult('Second'), time2, deliverFn);
      expect(deliveredResults).toHaveLength(0);

      // Advance time past threshold
      vi.advanceTimersByTime(16 * 60 * 1000);

      // Clean up stale job-1
      service.cleanupStaleJobs();

      // Channel queue should still exist (has buffered result)
      expect(service.getStats().channelCount).toBe(1);
      expect(service.getStats().totalBuffered).toBe(1);
    });

    it('should return empty result when no stale jobs exist', () => {
      const result = service.cleanupStaleJobs();

      expect(result.cleanedCount).toBe(0);
      expect(result.channelsCleaned).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return accurate statistics', async () => {
      // Initial state
      expect(service.getStats()).toEqual({ channelCount: 0, totalPending: 0, totalBuffered: 0 });

      // Add some pending jobs with DIFFERENT timestamps (important for ordering)
      const time1 = new Date('2024-01-01T10:00:00Z');
      const time2 = new Date('2024-01-01T10:01:00Z');
      const time3 = new Date('2024-01-01T10:02:00Z');

      service.registerJob('ch-1', 'job-1', time1);
      service.registerJob('ch-1', 'job-2', time2);
      service.registerJob('ch-2', 'job-3', time3);

      expect(service.getStats()).toEqual({ channelCount: 2, totalPending: 3, totalBuffered: 0 });

      // Buffer a result - job-2 completes but job-1 (older) is still pending
      await service.handleResult('ch-1', 'job-2', createResult('test'), time2, deliverFn);

      // job-2 is buffered because job-1 is still pending
      expect(service.getStats().totalBuffered).toBe(1);
    });
  });
});
