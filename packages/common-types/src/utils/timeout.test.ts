/**
 * Tests for timeout calculation utilities
 *
 * NEW ARCHITECTURE: Independent component budgets (not sequential subtraction)
 */

import { describe, it, expect } from 'vitest';
import { calculateJobTimeout } from './timeout.js';
import { TIMEOUTS } from '../constants/index.js';

describe('calculateJobTimeout - Independent Component Budgets', () => {
  describe('No attachments', () => {
    it('should return overhead + LLM budget for 0 images and 0 audio', () => {
      // SYSTEM_OVERHEAD (15s) + LLM_INVOCATION (480s) = 495s
      const timeout = calculateJobTimeout(0, 0);
      expect(timeout).toBe(TIMEOUTS.SYSTEM_OVERHEAD + TIMEOUTS.LLM_INVOCATION); // 495s
    });
  });

  describe('Image attachments (parallel processing)', () => {
    it('should calculate timeout for 1 image with independent LLM budget', () => {
      // SYSTEM_OVERHEAD: 15s
      // VISION_MODEL: 90s
      // LLM_INVOCATION: 480s
      // Total: 15s + 90s + 480s = 585s
      const timeout = calculateJobTimeout(1, 0);
      expect(timeout).toBe(585000);
    });

    it('should NOT scale linearly with image count (parallel processing)', () => {
      // IMPORTANT: Images are processed in PARALLEL
      // 5 images take the same time as 1 image (one batch)
      const oneImage = calculateJobTimeout(1, 0);
      const fiveImages = calculateJobTimeout(5, 0);

      expect(oneImage).toBe(fiveImages); // Both 585s
    });

    it('should handle large image count (still one parallel batch)', () => {
      // Even 100 images: same timeout (parallel processing)
      const timeout = calculateJobTimeout(100, 0);
      expect(timeout).toBe(585000); // 15s + 90s + 480s
    });
  });

  describe('Audio attachments', () => {
    it('should calculate timeout for 1 audio with independent LLM budget', () => {
      // SYSTEM_OVERHEAD: 15s
      // AUDIO_FETCH + WHISPER_API: 30s + 180s = 210s
      // LLM_INVOCATION: 480s
      // Total: 15s + 210s + 480s = 705s (capped at JOB_WAIT 600s)
      const timeout = calculateJobTimeout(0, 1);
      expect(timeout).toBe(TIMEOUTS.JOB_WAIT); // 600s (capped)
    });

    it('should NOT scale with audio count (parallel processing)', () => {
      const oneAudio = calculateJobTimeout(0, 1);
      const threeAudio = calculateJobTimeout(0, 3);

      expect(oneAudio).toBe(threeAudio); // Both 600s (capped)
    });
  });

  describe('Mixed attachments', () => {
    it('should use slowest attachment type (audio wins)', () => {
      // SYSTEM_OVERHEAD: 15s
      // Images: 90s
      // Audio: 210s (30s + 180s)
      // Slowest wins: 210s
      // LLM_INVOCATION: 480s
      // Total: 15s + 210s + 480s = 705s (capped at 600s)
      const timeout = calculateJobTimeout(3, 2);
      expect(timeout).toBe(TIMEOUTS.JOB_WAIT); // 600s (capped)
    });

    it('should handle images only (under cap)', () => {
      // Images only: 15s + 90s + 480s = 585s
      const timeout = calculateJobTimeout(10, 0);
      expect(timeout).toBe(585000);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical single image request', () => {
      // 1 image: 15s + 90s + 480s = 585s
      const timeout = calculateJobTimeout(1, 0);
      expect(timeout).toBe(585000); // 9.75 minutes
    });

    it('should handle moderate multi-image request', () => {
      // 3 images (parallel): same as 1 image
      const timeout = calculateJobTimeout(3, 0);
      expect(timeout).toBe(585000); // 9.75 minutes
    });

    it('should handle voice message request', () => {
      // 1 audio: 15s + 210s + 480s = 705s (capped at 600s)
      const timeout = calculateJobTimeout(0, 1);
      expect(timeout).toBe(600000); // 10 minutes (capped)
    });

    it('should handle mixed media request', () => {
      // Images + audio: audio dominates
      // 15s + 210s + 480s = 705s (capped at 600s)
      const timeout = calculateJobTimeout(2, 1);
      expect(timeout).toBe(600000); // 10 minutes (capped)
    });
  });

  describe('Railway limit enforcement', () => {
    it('should cap at JOB_WAIT (Railway 10 min limit)', () => {
      // Any combination exceeding 600s should be capped
      const timeout = calculateJobTimeout(10, 10);
      expect(timeout).toBe(TIMEOUTS.JOB_WAIT); // 600s
    });
  });

  it('should demonstrate job timeout increases with attachments', () => {
    // Job timeout should increase with attachments (additive model)
    // LLM always gets full TIMEOUTS.LLM_INVOCATION (480s) regardless of attachments
    const noAttachments = calculateJobTimeout(0, 0); // 495s
    const withImages = calculateJobTimeout(5, 0); // 585s
    const withAudio = calculateJobTimeout(0, 1); // 600s (capped)

    expect(withImages).toBeGreaterThan(noAttachments); // Images add time
    expect(withAudio).toBeGreaterThan(withImages); // Audio adds more time
  });
});
