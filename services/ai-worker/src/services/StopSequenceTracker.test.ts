/**
 * Tests for StopSequenceTracker
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  recordStopSequenceActivation,
  getStopSequenceStats,
  resetStopSequenceStats,
} from './StopSequenceTracker.js';

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

    it('should reset the startedAt timestamp', () => {
      const beforeReset = getStopSequenceStats().startedAt;

      // Small delay to ensure different timestamp
      vi.advanceTimersByTime?.(100);
      resetStopSequenceStats();

      const afterReset = getStopSequenceStats().startedAt;
      // After reset, startedAt should be >= the previous value
      expect(new Date(afterReset).getTime()).toBeGreaterThanOrEqual(
        new Date(beforeReset).getTime()
      );
    });
  });
});
