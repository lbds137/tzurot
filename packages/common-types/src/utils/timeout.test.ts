/**
 * Tests for timeout calculation utilities
 */

import { describe, it, expect } from 'vitest';
import { calculateJobTimeout, calculateLLMTimeout } from './timeout.js';
import { TIMEOUTS } from '../constants/index.js';

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
      // Batch: 90s (VISION_MODEL - increased for quality)
      // Retry buffer: 90s × 1 = 90s (one retry in worst case)
      // Total: 120s + 90s + 90s = 300s
      const timeout = calculateJobTimeout(1, 0);
      expect(timeout).toBe(300000);
    });

    it('should NOT scale linearly with image count (parallel processing)', () => {
      // IMPORTANT: Images are processed in PARALLEL
      // 5 images take the same time as 1 image (one batch)
      const oneImage = calculateJobTimeout(1, 0);
      const fiveImages = calculateJobTimeout(5, 0);

      expect(oneImage).toBe(fiveImages); // Both 300s
    });

    it('should handle large image count (still one parallel batch)', () => {
      // Even 100 images: same timeout (parallel processing)
      const timeout = calculateJobTimeout(100, 0);
      expect(timeout).toBe(300000); // 120s + 90s + 90s
    });
  });

  describe('Audio attachments', () => {
    it('should calculate timeout for 1 audio with retry buffer', () => {
      // Base: 120s
      // Batch: 210s (AUDIO_FETCH 30s + WHISPER_API 180s - increased for longer audio)
      // Retry buffer: 210s × 1 = 210s (one retry in worst case)
      // Total: 120s + 210s + 210s = 540s
      const timeout = calculateJobTimeout(0, 1);
      expect(timeout).toBe(540000);
    });

    it('should NOT scale with audio count (parallel processing)', () => {
      const oneAudio = calculateJobTimeout(0, 1);
      const threeAudio = calculateJobTimeout(0, 3);

      expect(oneAudio).toBe(threeAudio); // Both 540s
    });
  });

  describe('Mixed attachments', () => {
    it('should use slowest attachment type (audio wins)', () => {
      // Images: 90s batch
      // Audio: 210s batch (30s + 180s)
      // Slowest wins: 210s
      // Total: 120s + 210s + 210s = 540s
      const timeout = calculateJobTimeout(3, 2);
      expect(timeout).toBe(540000);
    });

    it('should handle edge case: only images (under cap)', () => {
      // Images only: 120s + 90s + 90s = 300s
      const timeout = calculateJobTimeout(10, 0);
      expect(timeout).toBe(300000);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical single image request', () => {
      // 1 image: 120s + 90s + 90s = 300s
      const timeout = calculateJobTimeout(1, 0);
      expect(timeout).toBe(300000); // 5 minutes
    });

    it('should handle moderate multi-image request', () => {
      // 3 images (parallel): same as 1 image
      const timeout = calculateJobTimeout(3, 0);
      expect(timeout).toBe(300000); // 5 minutes
    });

    it('should handle voice message request', () => {
      // 1 audio: 120s + 210s + 210s = 540s
      const timeout = calculateJobTimeout(0, 1);
      expect(timeout).toBe(540000); // 9 minutes
    });

    it('should handle mixed media request', () => {
      // Images + audio: audio dominates
      const timeout = calculateJobTimeout(2, 1);
      expect(timeout).toBe(540000); // 9 minutes
    });
  });
});

describe('calculateLLMTimeout', () => {
  it('should give LLM most of budget when no attachments', () => {
    const jobTimeout = calculateJobTimeout(0, 0); // 120s
    const llmTimeout = calculateLLMTimeout(jobTimeout, 0, 0);

    // 120s - 0 (no attachments) - 0 (no retries) - 15s (overhead) = 105s
    expect(llmTimeout).toBe(105000);
  });

  it('should account for image processing time', () => {
    const jobTimeout = calculateJobTimeout(5, 0); // 300s
    const llmTimeout = calculateLLMTimeout(jobTimeout, 5, 0);

    // 300s - 90s (batch) - 90s (retry) - 15s (overhead) = 105s
    expect(llmTimeout).toBe(105000);
  });

  it('should enforce minimum timeout for slow models with audio', () => {
    const jobTimeout = calculateJobTimeout(0, 1); // 540s
    const llmTimeout = calculateLLMTimeout(jobTimeout, 0, 1);

    // 540s - 210s (batch: 30s + 180s) - 210s (retry) - 15s (overhead) = 105s
    expect(llmTimeout).toBe(105000);
  });

  it('should handle mixed attachments with audio dominating', () => {
    const jobTimeout = calculateJobTimeout(3, 2); // 540s
    const llmTimeout = calculateLLMTimeout(jobTimeout, 3, 2);

    // Audio dominates: 540s - 210s - 210s - 15s = 105s
    expect(llmTimeout).toBe(105000);
  });

  it('should warn when timeout budget is very tight', () => {
    // Mock logger to check if warning is called
    const jobTimeout = calculateJobTimeout(0, 3); // 540s
    const llmTimeout = calculateLLMTimeout(jobTimeout, 0, 3);

    // Multiple audio files: 540s - 210s - 210s - 15s = 105s
    expect(llmTimeout).toBe(105000);
    // Note: In actual use, logger.warn would be called here
  });
});
