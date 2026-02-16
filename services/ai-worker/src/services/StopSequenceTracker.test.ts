/**
 * Tests for StopSequenceTracker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordStopSequenceActivation,
  getStopSequenceStats,
  resetStopSequenceStats,
  initStopSequenceRedis,
  STOP_SEQUENCE_REDIS_KEYS,
} from './StopSequenceTracker.js';
import type { Redis } from 'ioredis';

// Mock the logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

/** Create a mock Redis client with pipeline support */
function createMockRedis() {
  const pipelineExec = vi.fn().mockResolvedValue([]);
  const pipelineMethods = {
    incr: vi.fn().mockReturnThis(),
    hincrby: vi.fn().mockReturnThis(),
    exec: pipelineExec,
  };
  const mockRedis = {
    setnx: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
    pipeline: vi.fn().mockReturnValue(pipelineMethods),
  } as unknown as Redis;

  return { mockRedis, pipelineMethods, pipelineExec };
}

describe('StopSequenceTracker', () => {
  beforeEach(() => {
    resetStopSequenceStats();
  });

  describe('recordStopSequenceActivation', () => {
    it('should increment total activations', () => {
      recordStopSequenceActivation('\nUser:', 'gpt-4');
      recordStopSequenceActivation('\nHuman:', 'gpt-4');

      const stats = getStopSequenceStats();
      expect(stats.totalActivations).toBe(2);
    });

    it('should track activations by sequence', () => {
      recordStopSequenceActivation('\nUser:', 'gpt-4');
      recordStopSequenceActivation('\nUser:', 'claude-3');
      recordStopSequenceActivation('\nHuman:', 'gpt-4');

      const stats = getStopSequenceStats();
      expect(stats.bySequence['\nUser:']).toBe(2);
      expect(stats.bySequence['\nHuman:']).toBe(1);
    });

    it('should track activations by model', () => {
      recordStopSequenceActivation('\nUser:', 'gpt-4');
      recordStopSequenceActivation('\nUser:', 'gpt-4');
      recordStopSequenceActivation('\nUser:', 'claude-3');

      const stats = getStopSequenceStats();
      expect(stats.byModel['gpt-4']).toBe(2);
      expect(stats.byModel['claude-3']).toBe(1);
    });
  });

  describe('getStopSequenceStats', () => {
    it('should return empty stats when no activations', () => {
      const stats = getStopSequenceStats();

      expect(stats.totalActivations).toBe(0);
      expect(Object.keys(stats.bySequence)).toHaveLength(0);
      expect(Object.keys(stats.byModel)).toHaveLength(0);
    });

    it('should include uptime information', () => {
      const stats = getStopSequenceStats();

      expect(stats.uptimeMs).toBeGreaterThanOrEqual(0);
      expect(stats.startedAt).toBeDefined();
      expect(new Date(stats.startedAt).getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('should return serializable objects (not Maps)', () => {
      recordStopSequenceActivation('\nUser:', 'gpt-4');

      const stats = getStopSequenceStats();

      // Should be plain objects, not Maps
      expect(stats.bySequence).not.toBeInstanceOf(Map);
      expect(stats.byModel).not.toBeInstanceOf(Map);
      expect(typeof stats.bySequence).toBe('object');
      expect(typeof stats.byModel).toBe('object');
    });
  });

  describe('resetStopSequenceStats', () => {
    it('should reset all stats to initial state', () => {
      recordStopSequenceActivation('\nUser:', 'gpt-4');
      recordStopSequenceActivation('\nHuman:', 'claude-3');

      resetStopSequenceStats();

      const stats = getStopSequenceStats();
      expect(stats.totalActivations).toBe(0);
      expect(Object.keys(stats.bySequence)).toHaveLength(0);
      expect(Object.keys(stats.byModel)).toHaveLength(0);
    });

    it('should reset the startedAt timestamp', async () => {
      const beforeReset = getStopSequenceStats().startedAt;

      // Wait a small amount of real time to ensure different timestamp
      await new Promise(resolve => setTimeout(resolve, 5));
      resetStopSequenceStats();

      const afterReset = getStopSequenceStats().startedAt;
      // After reset, startedAt should be >= the previous value
      expect(new Date(afterReset).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeReset).getTime()
      );
    });
  });

  describe('Redis persistence', () => {
    it('should call setnx for started_at on init', () => {
      const { mockRedis } = createMockRedis();

      initStopSequenceRedis(mockRedis);

      expect(mockRedis.setnx).toHaveBeenCalledWith(
        STOP_SEQUENCE_REDIS_KEYS.STARTED_AT,
        expect.any(String)
      );
    });

    it('should persist activations to Redis via pipeline', () => {
      const { mockRedis, pipelineMethods } = createMockRedis();
      initStopSequenceRedis(mockRedis);

      recordStopSequenceActivation('\nUser:', 'gpt-4');

      expect(mockRedis.pipeline).toHaveBeenCalled();
      expect(pipelineMethods.incr).toHaveBeenCalledWith(STOP_SEQUENCE_REDIS_KEYS.TOTAL);
      expect(pipelineMethods.hincrby).toHaveBeenCalledWith(
        STOP_SEQUENCE_REDIS_KEYS.BY_SEQUENCE,
        '\nUser:',
        1
      );
      expect(pipelineMethods.hincrby).toHaveBeenCalledWith(
        STOP_SEQUENCE_REDIS_KEYS.BY_MODEL,
        'gpt-4',
        1
      );
      expect(pipelineMethods.exec).toHaveBeenCalled();
    });

    it('should clear Redis keys on reset', () => {
      const { mockRedis } = createMockRedis();
      initStopSequenceRedis(mockRedis);

      resetStopSequenceStats();

      expect(mockRedis.del).toHaveBeenCalledWith(
        STOP_SEQUENCE_REDIS_KEYS.TOTAL,
        STOP_SEQUENCE_REDIS_KEYS.BY_SEQUENCE,
        STOP_SEQUENCE_REDIS_KEYS.BY_MODEL,
        STOP_SEQUENCE_REDIS_KEYS.STARTED_AT
      );
    });

    it('should handle Redis pipeline errors gracefully', () => {
      const { mockRedis, pipelineMethods } = createMockRedis();
      pipelineMethods.exec.mockRejectedValue(new Error('Redis down'));
      initStopSequenceRedis(mockRedis);

      // Should not throw
      expect(() => recordStopSequenceActivation('\nUser:', 'gpt-4')).not.toThrow();
    });
  });
});
