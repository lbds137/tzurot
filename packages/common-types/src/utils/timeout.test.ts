/**
 * Tests for timeout calculation utilities
 *
 * NEW ARCHITECTURE: Independent component budgets WITH RETRY SUPPORT
 * - Preprocessing jobs retry up to 3 times with exponential backoff
 * - Each component gets its full timeout budget regardless of other components
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
    it('caps the audio job at MAX_JOB_RUNTIME (retry budget exceeds the cap)', () => {
      // SYSTEM_OVERHEAD: 15s
      // AUDIO_FETCH + VOICE_ENGINE_API with retries: 510s × 3 attempts + 3s delays = 1533s
      // LLM_INVOCATION: 480s → 15 + 1533 + 480 = 2028s, clamped to the 20-min runtime cap.
      const timeout = calculateJobTimeout(0, 1);
      expect(timeout).toBe(TIMEOUTS.MAX_JOB_RUNTIME); // 1200s (capped)
    });

    it('should NOT scale with audio count (both capped)', () => {
      const oneAudio = calculateJobTimeout(0, 1);
      const threeAudio = calculateJobTimeout(0, 3);

      expect(oneAudio).toBe(threeAudio); // Both capped at MAX_JOB_RUNTIME
    });
  });

  describe('Mixed attachments', () => {
    it('should use slowest attachment type (audio wins, capped)', () => {
      // Audio (1533s) is slower than images (273s); audio's component pushes the total
      // over the runtime cap.
      const timeout = calculateJobTimeout(3, 2);
      expect(timeout).toBe(TIMEOUTS.MAX_JOB_RUNTIME); // Audio wins, capped
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
      // User sends voice message — audio retry budget caps the job at MAX_JOB_RUNTIME.
      const timeout = calculateJobTimeout(0, 1);
      expect(timeout).toBe(TIMEOUTS.MAX_JOB_RUNTIME); // 1200s (capped)
    });

    it('should handle mixed media request', () => {
      // User sends 2 images + 1 audio — audio wins and caps at MAX_JOB_RUNTIME.
      const timeout = calculateJobTimeout(2, 1);
      expect(timeout).toBe(TIMEOUTS.MAX_JOB_RUNTIME); // Audio timeout wins, capped
    });
  });

  describe('Max job runtime enforcement', () => {
    it('should cap at MAX_JOB_RUNTIME (20 min safety net)', () => {
      // Audio's retry budget (1533s) + LLM (480s) + overhead exceeds the cap, so any
      // request with audio clamps to MAX_JOB_RUNTIME.
      const timeout = calculateJobTimeout(10, 10);
      expect(timeout).toBe(TIMEOUTS.MAX_JOB_RUNTIME); // Capped
    });

    it('does NOT cap an images-only request (stays under the cap)', () => {
      // Images alone (273s + 480s + 15s = 768s) stay well under the cap.
      const timeout = calculateJobTimeout(10, 0);
      expect(timeout).toBe(768000);
      expect(timeout).toBeLessThan(TIMEOUTS.MAX_JOB_RUNTIME);
    });

    it('clamps to MAX_JOB_RUNTIME, never the (shorter, auto-renewed) worker lock', () => {
      // The lock bounds dead-process detection, not runtime — locks auto-renew
      // while the worker lives. Clamping to the lock would clip long audio/vision
      // jobs; this pins the decoupling so a future "simplification" can't rewire it.
      expect(TIMEOUTS.WORKER_LOCK_DURATION).toBeLessThan(TIMEOUTS.MAX_JOB_RUNTIME);
      expect(calculateJobTimeout(0, 1)).toBeGreaterThan(TIMEOUTS.WORKER_LOCK_DURATION);
    });
  });

  describe('Architecture correctness', () => {
    it('should demonstrate independent budgets - image attachments do not reduce LLM time', () => {
      const noAttachments = calculateJobTimeout(0, 0);
      const withImages = calculateJobTimeout(5, 0);
      const withAudio = calculateJobTimeout(0, 1);

      // No-attachment and image jobs preserve the full independent LLM budget.
      expect(noAttachments).toBe(495000); // 15s + 480s
      expect(withImages).toBe(768000); // 15s + 273s + 480s (LLM still gets 480s!)
      // Audio's retry budget alone exceeds the runtime cap, so the audio job clamps to
      // the cap — the per-component independent-budget property gives way to the safety
      // net here (the actual STT call self-limits to one ~480s attempt).
      expect(withAudio).toBe(TIMEOUTS.MAX_JOB_RUNTIME);
    });

    it('should demonstrate retry budget - preprocessing can retry without starving LLM', () => {
      // With retries:
      // - Images: 273s (3 attempts + delays) vs old 90s (1 attempt) — under the cap
      // - Audio: 1533s (3 attempts + delays) — exceeds the cap on its own
      // - LLM: still gets its full 480s for the image case (audio clamps to the cap)

      const imageTimeout = calculateJobTimeout(1, 0);
      const audioTimeout = calculateJobTimeout(0, 1);

      // Verify preprocessing gets retry budget
      expect(imageTimeout).toBeGreaterThan(495000 + 90000); // More than single attempt
      expect(audioTimeout).toBeGreaterThan(495000 + 210000); // More than single attempt

      // Image job still grants LLM its full independent 480s (verified by subtraction).
      expect(imageTimeout - TIMEOUTS.SYSTEM_OVERHEAD - 273000).toBe(TIMEOUTS.LLM_INVOCATION);
      // Audio job is clamped to MAX_JOB_RUNTIME — its uncapped budget (2028s) would have
      // exceeded it, so the cap is what holds.
      expect(audioTimeout).toBe(TIMEOUTS.MAX_JOB_RUNTIME);
    });
  });
});
