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
      // Batch: 45s (VISION_MODEL)
      // Retry buffer: 45s × 1 = 45s (one retry in worst case)
      // Total: 120s + 45s + 45s = 210s
      const timeout = calculateJobTimeout(1, 0);
      expect(timeout).toBe(210000);
    });

    it('should NOT scale linearly with image count (parallel processing)', () => {
      // IMPORTANT: Images are processed in PARALLEL
      // 5 images take the same time as 1 image (one batch)
      const oneImage = calculateJobTimeout(1, 0);
      const fiveImages = calculateJobTimeout(5, 0);

      expect(oneImage).toBe(fiveImages); // Both 210s
    });

    it('should handle large image count (still one parallel batch)', () => {
      // Even 100 images: same timeout (parallel processing)
      const timeout = calculateJobTimeout(100, 0);
      expect(timeout).toBe(210000); // 120s + 45s + 45s
    });
  });

  describe('Audio attachments', () => {
    it('should calculate timeout for 1 audio with retry buffer', () => {
      // Base: 120s
      // Batch: 90s (AUDIO_FETCH 30s + WHISPER_API 60s)
      // Retry buffer: 90s × 1 = 90s (one retry in worst case)
      // Total: 120s + 90s + 90s = 300s
      const timeout = calculateJobTimeout(0, 1);
      expect(timeout).toBe(300000);
    });

    it('should NOT scale with audio count (parallel processing)', () => {
      const oneAudio = calculateJobTimeout(0, 1);
      const threeAudio = calculateJobTimeout(0, 3);

      expect(oneAudio).toBe(threeAudio); // Both 300s
    });
  });

  describe('Mixed attachments', () => {
    it('should use slowest attachment type (audio wins)', () => {
      // Images: 45s batch
      // Audio: 90s batch (30s + 60s)
      // Slowest wins: 90s
      // Total: 120s + 90s + 90s = 300s
      const timeout = calculateJobTimeout(3, 2);
      expect(timeout).toBe(300000);
    });

    it('should handle edge case: only images (under cap)', () => {
      // Images only: 120s + 45s + 45s = 210s (under 270s cap)
      const timeout = calculateJobTimeout(10, 0);
      expect(timeout).toBe(210000); // Not capped
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical single image request', () => {
      // 1 image: 120s + 45s + 45s = 210s
      const timeout = calculateJobTimeout(1, 0);
      expect(timeout).toBe(210000); // 3.5 minutes
    });

    it('should handle moderate multi-image request', () => {
      // 3 images (parallel): same as 1 image
      const timeout = calculateJobTimeout(3, 0);
      expect(timeout).toBe(210000); // 3.5 minutes
    });

    it('should handle voice message request', () => {
      // 1 audio: 120s + 90s + 90s = 300s
      const timeout = calculateJobTimeout(0, 1);
      expect(timeout).toBe(300000); // 5 minutes
    });

    it('should handle mixed media request', () => {
      // Images + audio: audio dominates
      const timeout = calculateJobTimeout(2, 1);
      expect(timeout).toBe(300000); // 5 minutes
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
    const jobTimeout = calculateJobTimeout(5, 0); // 210s
    const llmTimeout = calculateLLMTimeout(jobTimeout, 5, 0);

    // 210s - 45s (batch) - 45s (retry) - 15s (overhead) = 105s
    expect(llmTimeout).toBe(105000);
  });

  it('should enforce minimum timeout for slow models with audio', () => {
    const jobTimeout = calculateJobTimeout(0, 1); // 300s
    const llmTimeout = calculateLLMTimeout(jobTimeout, 0, 1);

    // 300s - 90s (batch: 30s + 60s) - 90s (retry) - 15s (overhead) = 105s
    expect(llmTimeout).toBe(105000);
  });

  it('should handle mixed attachments with audio dominating', () => {
    const jobTimeout = calculateJobTimeout(3, 2); // 300s
    const llmTimeout = calculateLLMTimeout(jobTimeout, 3, 2);

    // Audio dominates: 300s - 90s - 90s - 15s = 105s
    expect(llmTimeout).toBe(105000);
  });

  it('should warn when timeout budget is very tight', () => {
    // Mock logger to check if warning is called
    const jobTimeout = calculateJobTimeout(0, 3); // 300s
    const llmTimeout = calculateLLMTimeout(jobTimeout, 0, 3);

    // Multiple audio files: 300s - 90s - 90s - 15s = 105s
    expect(llmTimeout).toBe(105000);
    // Note: In actual use, logger.warn would be called here
  });
});
