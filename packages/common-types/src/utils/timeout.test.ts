/**
 * Tests for timeout calculation utilities
 */

import { describe, it, expect } from 'vitest';
import { calculateJobTimeout, calculateLLMTimeout } from './timeout.js';
import { TIMEOUTS } from '../config/constants.js';

describe('calculateJobTimeout', () => {
  describe('No attachments', () => {
    it('should return base timeout for 0 images and 0 audio', () => {
      const timeout = calculateJobTimeout(0, 0);
      expect(timeout).toBe(TIMEOUTS.JOB_BASE); // 120s
    });
  });

  describe('Image attachments (parallel processing)', () => {
    it('should calculate timeout for 1 image with retry buffer', () => {
      // Base: 120s
      // Batch: 45s (VISION_MODEL)
      // Retry buffer: 45s × 2 = 90s
      // Total: 120s + 45s + 90s = 255s
      const timeout = calculateJobTimeout(1, 0);
      expect(timeout).toBe(255000);
    });

    it('should NOT scale linearly with image count (parallel processing)', () => {
      // IMPORTANT: Images are processed in PARALLEL
      // 5 images take the same time as 1 image (one batch)
      const oneImage = calculateJobTimeout(1, 0);
      const fiveImages = calculateJobTimeout(5, 0);

      expect(oneImage).toBe(fiveImages); // Both 255s
    });

    it('should handle large image count (still one parallel batch)', () => {
      // Even 100 images: same timeout (parallel processing)
      const timeout = calculateJobTimeout(100, 0);
      expect(timeout).toBe(255000); // 120s + 45s + 90s
    });
  });

  describe('Audio attachments', () => {
    it('should calculate timeout for 1 audio with retry buffer', () => {
      // Base: 120s
      // Batch: 90s (WHISPER_API)
      // Retry buffer: 90s × 2 = 180s
      // Total: 120s + 90s + 180s = 390s → capped at 270s
      const timeout = calculateJobTimeout(0, 1);
      expect(timeout).toBe(TIMEOUTS.JOB_WAIT); // Capped at 270s
    });

    it('should NOT scale with audio count (parallel processing)', () => {
      const oneAudio = calculateJobTimeout(0, 1);
      const threeAudio = calculateJobTimeout(0, 3);

      expect(oneAudio).toBe(threeAudio); // Both capped at 270s
    });
  });

  describe('Mixed attachments', () => {
    it('should use slowest attachment type (audio wins)', () => {
      // Images: 45s batch
      // Audio: 90s batch
      // Slowest wins: 90s
      // Total: 120s + 90s + 180s = 390s → capped at 270s
      const timeout = calculateJobTimeout(3, 2);
      expect(timeout).toBe(TIMEOUTS.JOB_WAIT); // Capped
    });

    it('should handle edge case: only images (under cap)', () => {
      // Images only: 120s + 45s + 90s = 255s (under 270s cap)
      const timeout = calculateJobTimeout(10, 0);
      expect(timeout).toBe(255000); // Not capped
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical single image request', () => {
      // 1 image: 120s + 45s + 90s = 255s
      const timeout = calculateJobTimeout(1, 0);
      expect(timeout).toBe(255000); // 4.25 minutes
    });

    it('should handle moderate multi-image request', () => {
      // 3 images (parallel): same as 1 image
      const timeout = calculateJobTimeout(3, 0);
      expect(timeout).toBe(255000); // 4.25 minutes
    });

    it('should handle voice message request', () => {
      // 1 audio: capped at JOB_WAIT
      const timeout = calculateJobTimeout(0, 1);
      expect(timeout).toBe(270000); // 4.5 minutes (capped)
    });

    it('should handle mixed media request', () => {
      // Images + audio: audio dominates, capped
      const timeout = calculateJobTimeout(2, 1);
      expect(timeout).toBe(270000); // 4.5 minutes (capped)
    });
  });
});

describe('calculateLLMTimeout', () => {
  it('should give LLM most of budget when no attachments', () => {
    const jobTimeout = calculateJobTimeout(0, 0); // 120s
    const llmTimeout = calculateLLMTimeout(jobTimeout, 0, 0);

    // 120s - 0 (no attachments) - 0 (no retries) - 15s (overhead) = 105s
    // BUT minimum is 120s, so returns 120s
    expect(llmTimeout).toBe(120000);
  });

  it('should account for image processing time', () => {
    const jobTimeout = calculateJobTimeout(5, 0); // 255s
    const llmTimeout = calculateLLMTimeout(jobTimeout, 5, 0);

    // 255s - 45s (batch) - 90s (retries) - 15s (overhead) = 105s
    // BUT minimum is 120s, so returns 120s
    expect(llmTimeout).toBe(120000);
  });

  it('should enforce minimum timeout for slow models', () => {
    const jobTimeout = calculateJobTimeout(0, 1); // 270s (capped)
    const llmTimeout = calculateLLMTimeout(jobTimeout, 0, 1);

    // 270s - 90s (batch) - 180s (retries) - 15s (overhead) = -15s
    // But minimum is 120s
    expect(llmTimeout).toBe(120000);
  });

  it('should handle mixed attachments', () => {
    const jobTimeout = calculateJobTimeout(3, 2); // 270s (capped)
    const llmTimeout = calculateLLMTimeout(jobTimeout, 3, 2);

    // Audio dominates: 270s - 90s - 180s - 15s = -15s → 120s minimum
    expect(llmTimeout).toBe(120000);
  });
});
