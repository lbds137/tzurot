/**
 * Tests for timeout calculation utilities
 *
 * NEW ARCHITECTURE: Independent component budgets WITH RETRY SUPPORT
 * - Preprocessing jobs retry up to 3 times with exponential backoff
 * - Each component gets full timeout budget regardless of other components
 */

import { describe, it, expect } from 'vitest';
import { calculateJobTimeout } from './timeout.js';
import { TIMEOUTS } from '../constants/index.js';

describe('calculateJobTimeout - Independent Component Budgets with Retries', () => {
  describe('No attachments', () => {
    it('should return overhead + LLM budget for 0 images and 0 audio', () => {
      // SYSTEM_OVERHEAD (15s) + LLM_INVOCATION (480s) = 495s
      const timeout = calculateJobTimeout(0, 0);
      expect(timeout).toBe(TIMEOUTS.SYSTEM_OVERHEAD + TIMEOUTS.LLM_INVOCATION); // 495s
    });
  });

  describe('Image attachments (parallel processing with retries)', () => {
    it('should calculate timeout for 1 image with retries + independent LLM budget', () => {
      // SYSTEM_OVERHEAD: 15s
      // VISION_MODEL with retries: 90s × 3 attempts + 3s delays = 273s
      // LLM_INVOCATION: 480s
      // Total: 15s + 273s + 480s = 768s
      const timeout = calculateJobTimeout(1, 0);
      expect(timeout).toBe(768000); // 768s
    });

    it('should NOT scale linearly with image count (parallel processing)', () => {
      // IMPORTANT: Images are processed in PARALLEL
      // 5 images take the same time as 1 image (one batch)
      const oneImage = calculateJobTimeout(1, 0);
      const fiveImages = calculateJobTimeout(5, 0);

      expect(oneImage).toBe(fiveImages); // Both 768s
    });

    it('should handle large image count (still one parallel batch)', () => {
      // Even 100 images: same timeout (parallel processing)
      const timeout = calculateJobTimeout(100, 0);
      expect(timeout).toBe(768000); // 15s + 273s + 480s
    });
  });

  describe('Audio attachments (with retries)', () => {
    it('should calculate timeout for 1 audio with retries + independent LLM budget', () => {
      // SYSTEM_OVERHEAD: 15s
      // AUDIO_FETCH + WHISPER_API with retries: 210s × 3 attempts + 3s delays = 633s
      // LLM_INVOCATION: 480s
      // Total: 15s + 633s + 480s = 1128s
      const timeout = calculateJobTimeout(0, 1);
      expect(timeout).toBe(1128000); // 1128s (18.8 minutes)
    });

    it('should NOT scale with audio count (parallel processing)', () => {
      const oneAudio = calculateJobTimeout(0, 1);
      const threeAudio = calculateJobTimeout(0, 3);

      expect(oneAudio).toBe(threeAudio); // Both 1128s
    });
  });

  describe('Mixed attachments', () => {
    it('should use slowest attachment type (audio wins)', () => {
      // Audio (633s) is slower than images (273s)
      // Total: 15s + 633s + 480s = 1128s
      const timeout = calculateJobTimeout(3, 2);
      expect(timeout).toBe(1128000); // Audio timeout wins
    });

    it('should handle images only (under cap)', () => {
      // Images only: 15s + 273s + 480s = 768s
      const timeout = calculateJobTimeout(10, 0);
      expect(timeout).toBe(768000);
    });
  });

  describe('Real-world scenarios', () => {
    it('should handle typical single image request', () => {
      // User sends 1 image
      const timeout = calculateJobTimeout(1, 0);
      expect(timeout).toBe(768000); // 768s (12.8 minutes)
    });

    it('should handle moderate multi-image request', () => {
      // User sends 5 images (parallel processing)
      const timeout = calculateJobTimeout(5, 0);
      expect(timeout).toBe(768000); // Same as single image
    });

    it('should handle voice message request', () => {
      // User sends voice message
      const timeout = calculateJobTimeout(0, 1);
      expect(timeout).toBe(1128000); // 1128s (18.8 minutes)
    });

    it('should handle mixed media request', () => {
      // User sends 2 images + 1 audio
      const timeout = calculateJobTimeout(2, 1);
      expect(timeout).toBe(1128000); // Audio timeout wins (18.8 minutes)
    });
  });

  describe('Worker lock duration enforcement', () => {
    it('should cap at WORKER_LOCK_DURATION (20 min safety net)', () => {
      // Any combination exceeding 1200s should be capped
      // Current max is audio (1128s), which is under the cap
      const timeout = calculateJobTimeout(10, 10);
      expect(timeout).toBe(1128000); // Under 1200s cap, so not capped
      expect(timeout).toBeLessThan(TIMEOUTS.WORKER_LOCK_DURATION);
    });
  });

  describe('Architecture correctness', () => {
    it('should demonstrate independent budgets - attachments do not reduce LLM time', () => {
      const noAttachments = calculateJobTimeout(0, 0);
      const withImages = calculateJobTimeout(5, 0);
      const withAudio = calculateJobTimeout(0, 1);

      // LLM always gets 480s regardless of attachments
      expect(noAttachments).toBe(495000); // 15s + 480s
      expect(withImages).toBe(768000); // 15s + 273s + 480s (LLM still gets 480s!)
      expect(withAudio).toBe(1128000); // 15s + 633s + 480s (LLM still gets 480s!)
    });

    it('should demonstrate retry budget - preprocessing can retry without starving LLM', () => {
      // With retries:
      // - Images: 273s (3 attempts + delays) vs old 90s (1 attempt)
      // - Audio: 633s (3 attempts + delays) vs old 210s (1 attempt)
      // - LLM: Still gets full 480s

      const imageTimeout = calculateJobTimeout(1, 0);
      const audioTimeout = calculateJobTimeout(0, 1);

      // Verify preprocessing gets retry budget
      expect(imageTimeout).toBeGreaterThan(495000 + 90000); // More than single attempt
      expect(audioTimeout).toBeGreaterThan(495000 + 210000); // More than single attempt

      // But LLM still gets full 480s (verified by subtraction)
      expect(imageTimeout - TIMEOUTS.SYSTEM_OVERHEAD - 273000).toBe(TIMEOUTS.LLM_INVOCATION);
      expect(audioTimeout - TIMEOUTS.SYSTEM_OVERHEAD - 633000).toBe(TIMEOUTS.LLM_INVOCATION);
    });
  });
});
