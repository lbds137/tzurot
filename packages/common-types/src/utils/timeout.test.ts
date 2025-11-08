/**
 * Tests for timeout calculation utilities
 */

import { describe, it, expect } from 'vitest';
import { calculateJobTimeout } from './timeout.js';
import { TIMEOUTS } from '../config/constants.js';

describe('calculateJobTimeout', () => {
  it('should return base timeout for 0 images', () => {
    const timeout = calculateJobTimeout(0);
    // Should use Math.max(1, 0) = 1, so 1 * JOB_BASE
    expect(timeout).toBe(TIMEOUTS.JOB_BASE);
  });

  it('should return base timeout for 1 image', () => {
    const timeout = calculateJobTimeout(1);
    expect(timeout).toBe(TIMEOUTS.JOB_BASE);
  });

  it('should scale timeout with image count', () => {
    const timeout = calculateJobTimeout(2);
    expect(timeout).toBe(TIMEOUTS.JOB_BASE * 2);
  });

  it('should cap timeout at JOB_WAIT maximum', () => {
    // Large image count that would exceed the cap
    const timeout = calculateJobTimeout(100);
    expect(timeout).toBe(TIMEOUTS.JOB_WAIT);
  });

  it('should cap timeout at JOB_WAIT for 10 images', () => {
    // 10 images * 120000ms = 1200000ms = 20 minutes
    // Should be capped at 270000ms = 4.5 minutes
    const timeout = calculateJobTimeout(10);
    expect(timeout).toBe(TIMEOUTS.JOB_WAIT);
  });

  it('should return exact calculation when under cap', () => {
    // 2 images: 2 * 120000 = 240000ms (under 270000ms cap)
    const timeout = calculateJobTimeout(2);
    expect(timeout).toBe(240000);
  });

  it('should handle edge case at the cap boundary', () => {
    // Find the image count that equals the cap
    // JOB_WAIT / JOB_BASE = 270000 / 120000 = 2.25
    // So 2 images is under, 3 images is over
    const twoImages = calculateJobTimeout(2);
    const threeImages = calculateJobTimeout(3);

    expect(twoImages).toBe(240000); // 2 * 120000
    expect(threeImages).toBe(TIMEOUTS.JOB_WAIT); // Capped
  });

  describe('Real-world scenarios', () => {
    it('should handle typical single image request', () => {
      const timeout = calculateJobTimeout(1);
      expect(timeout).toBe(120000); // 2 minutes
    });

    it('should handle moderate multi-image request', () => {
      const timeout = calculateJobTimeout(3);
      expect(timeout).toBe(270000); // Capped at 4.5 minutes
    });

    it('should handle heavy multi-image request', () => {
      const timeout = calculateJobTimeout(10);
      expect(timeout).toBe(270000); // Capped at 4.5 minutes
    });
  });
});
