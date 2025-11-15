/**
 * Tests for timeout calculation utilities
 *
 * NEW ARCHITECTURE: Independent component budgets (not sequential subtraction)
 */

import { describe, it, expect } from 'vitest';
import { calculateJobTimeout, calculateLLMTimeout } from './timeout.js';
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
});

describe('calculateLLMTimeout - Always Returns Constant', () => {
  it('should return constant LLM_INVOCATION regardless of attachments', () => {
    // NEW: LLM always gets full 480s budget
    const timeout = calculateLLMTimeout(0, 0, 0);
    expect(timeout).toBe(TIMEOUTS.LLM_INVOCATION); // 480s
  });

  it('should return same timeout with images', () => {
    const jobTimeout = calculateJobTimeout(5, 0);
    const llmTimeout = calculateLLMTimeout(jobTimeout, 5, 0);

    // LLM gets full budget regardless of images
    expect(llmTimeout).toBe(TIMEOUTS.LLM_INVOCATION); // 480s
  });

  it('should return same timeout with audio', () => {
    const jobTimeout = calculateJobTimeout(0, 1);
    const llmTimeout = calculateLLMTimeout(jobTimeout, 0, 1);

    // LLM gets full budget regardless of audio
    expect(llmTimeout).toBe(TIMEOUTS.LLM_INVOCATION); // 480s
  });

  it('should return same timeout with mixed attachments', () => {
    const jobTimeout = calculateJobTimeout(3, 2);
    const llmTimeout = calculateLLMTimeout(jobTimeout, 3, 2);

    // LLM gets full budget regardless of mixed media
    expect(llmTimeout).toBe(TIMEOUTS.LLM_INVOCATION); // 480s
  });

  it('should ignore job timeout parameter (backward compatibility)', () => {
    // Parameters are ignored - LLM always gets constant budget
    const timeout1 = calculateLLMTimeout(100000, 0, 0);
    const timeout2 = calculateLLMTimeout(600000, 10, 10);

    expect(timeout1).toBe(TIMEOUTS.LLM_INVOCATION); // 480s
    expect(timeout2).toBe(TIMEOUTS.LLM_INVOCATION); // 480s
    expect(timeout1).toBe(timeout2); // Both the same
  });

  it('should support proper retry budgets (3 attempts at 180s each)', () => {
    const llmTimeout = calculateLLMTimeout(0, 0, 0);

    // 480s supports 3 attempts × 180s per attempt = 540s max (capped at 480s)
    // Or 2 full attempts (360s) + 1 partial attempt (120s)
    expect(llmTimeout).toBe(480000);
    expect(llmTimeout).toBeGreaterThanOrEqual(TIMEOUTS.LLM_PER_ATTEMPT * 2); // At least 2 full attempts
  });
});

describe('Timeout Architecture Benefits', () => {
  it('should demonstrate LLM gets full budget regardless of attachments', () => {
    // OLD architecture: LLM would get less time with more attachments
    // NEW architecture: LLM always gets 480s

    const noAttachments = calculateLLMTimeout(calculateJobTimeout(0, 0), 0, 0);
    const withImages = calculateLLMTimeout(calculateJobTimeout(5, 0), 5, 0);
    const withAudio = calculateLLMTimeout(calculateJobTimeout(0, 1), 0, 1);
    const withBoth = calculateLLMTimeout(calculateJobTimeout(5, 1), 5, 1);

    // All should be equal - LLM doesn't compete with attachments
    expect(noAttachments).toBe(TIMEOUTS.LLM_INVOCATION);
    expect(withImages).toBe(TIMEOUTS.LLM_INVOCATION);
    expect(withAudio).toBe(TIMEOUTS.LLM_INVOCATION);
    expect(withBoth).toBe(TIMEOUTS.LLM_INVOCATION);
  });

  it('should demonstrate job timeout increases with attachments', () => {
    // Job timeout should increase with attachments (additive model)
    const noAttachments = calculateJobTimeout(0, 0); // 495s
    const withImages = calculateJobTimeout(5, 0); // 585s
    const withAudio = calculateJobTimeout(0, 1); // 600s (capped)

    expect(withImages).toBeGreaterThan(noAttachments); // Images add time
    expect(withAudio).toBeGreaterThan(withImages); // Audio adds more time
  });
});
