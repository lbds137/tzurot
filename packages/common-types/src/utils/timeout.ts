/**
 * Timeout calculation utilities
 */

import { TIMEOUTS, RETRY_CONFIG } from '../constants/index.js';

/**
 * Calculate total time for an operation including retry attempts and exponential backoff delays
 *
 * Formula: (perAttemptTimeout × maxAttempts) + sum(exponential backoff delays)
 * Backoff delays: 1s, 2s for attempts 2 and 3
 *
 * @param perAttemptTimeoutMs - Timeout for a single attempt
 * @param maxAttempts - Maximum number of attempts (default: RETRY_CONFIG.MAX_ATTEMPTS = 3)
 * @returns Total timeout including all retries and delays
 *
 * @example
 * // Audio: 210s per attempt × 3 attempts + delays (1s + 2s)
 * calculateTimeoutWithRetries(210_000, 3) // 633000ms (633s)
 *
 * @example
 * // Vision: 90s per attempt × 3 attempts + delays (1s + 2s)
 * calculateTimeoutWithRetries(90000, 3) // 273000ms (273s)
 */
function calculateTimeoutWithRetries(
  perAttemptTimeoutMs: number,
  maxAttempts: number = RETRY_CONFIG.MAX_ATTEMPTS
): number {
  // Total operation time for all attempts
  const operationTime = perAttemptTimeoutMs * maxAttempts;

  // Calculate exponential backoff delays between retries
  // Attempt 1: no delay before
  // After attempt 1: initialDelay * 2^0 = 1000ms
  // After attempt 2: initialDelay * 2^1 = 2000ms
  // (No delay after last attempt)
  let totalDelays = 0;
  for (let attempt = 1; attempt < maxAttempts; attempt++) {
    const baseDelay =
      RETRY_CONFIG.INITIAL_DELAY_MS * Math.pow(RETRY_CONFIG.BACKOFF_MULTIPLIER, attempt - 1);
    const delay = Math.min(baseDelay, RETRY_CONFIG.MAX_DELAY_MS);
    totalDelays += delay;
  }

  return operationTime + totalDelays;
}

/**
 * Calculate job timeout based on INDEPENDENT component budgets WITH RETRY SUPPORT
 *
 * NEW ARCHITECTURE: Each component gets its own independent timeout budget, and
 * preprocessing jobs retry up to 3 times with exponential backoff.
 *
 * Component breakdown (all independent, WITH RETRIES):
 * - Audio processing: (30s fetch + 180s STT) × 3 attempts + delays = 633s
 * - Image processing: 90s × 3 attempts + delays = 273s
 * - LLM invocation: 480s total (already includes retry budget)
 * - System overhead: 15s for DB, queue, network operations
 *
 * Total = max(attachment processing with retries) + LLM invocation + overhead
 *
 * Benefits:
 * - Preprocessing jobs can retry without gateway timeout
 * - LLM always gets 480s (8 min) regardless of preprocessing retries
 * - Attachments don't steal LLM time
 * - Supports proper retry budgets for all components
 *
 * @param imageCount - Number of images in the request
 * @param audioCount - Number of audio/voice attachments in the request
 * @returns Timeout in milliseconds, capped at MAX_JOB_RUNTIME (20 min safety net)
 *
 * @example
 * // No attachments: overhead + LLM
 * calculateJobTimeout(0, 0) // 15s + 480s = 495s
 *
 * @example
 * // 5 images (parallel): image with retries + LLM + overhead
 * calculateJobTimeout(5, 0) // 273s + 480s + 15s = 768s
 *
 * @example
 * // 1 audio: audio with retries + LLM + overhead exceeds the runtime cap.
 * // Audio component = (30s fetch + 480s STT) × 3 attempts + 3s = 1533s; + 480s LLM
 * // + 15s = 2028s, clamped to MAX_JOB_RUNTIME.
 * calculateJobTimeout(0, 1) // capped at 1200s (20 min)
 */
export function calculateJobTimeout(imageCount: number, audioCount = 0): number {
  let timeout = TIMEOUTS.SYSTEM_OVERHEAD; // 15s

  // Attachment processing time WITH RETRIES (components run in parallel, use slowest)
  // Images: 90s per attempt × 3 attempts + backoff delays (1s + 2s) = 273s
  const imageProcessingTime =
    imageCount > 0 ? calculateTimeoutWithRetries(TIMEOUTS.VISION_MODEL) : 0;

  // Audio: (30s fetch + 480s STT) per attempt × 3 attempts + backoff delays = 1533s.
  // With the long-audio STT budget, this alone exceeds MAX_JOB_RUNTIME, so an
  // audio request's job timeout clamps to that 20-min ceiling below (the actual STT
  // call self-limits to one ~480s attempt, so the cap is a safety net, not the budget).
  const audioProcessingTime =
    audioCount > 0
      ? calculateTimeoutWithRetries(TIMEOUTS.AUDIO_FETCH + TIMEOUTS.VOICE_ENGINE_API)
      : 0;

  const attachmentTime = Math.max(imageProcessingTime, audioProcessingTime);

  // Add LLM invocation time (INDEPENDENT of attachment processing)
  // LLM_INVOCATION already includes retry budget (480s total)
  timeout += attachmentTime + TIMEOUTS.LLM_INVOCATION;

  // Cap at MAX_JOB_RUNTIME (20 min) — the in-process ceiling for a LIVE job.
  // NOT the worker lock: locks auto-renew, so they bound dead-process
  // detection, never runtime. Clamping to the (shorter) lock would clip
  // legitimate long audio/vision jobs.
  return Math.min(timeout, TIMEOUTS.MAX_JOB_RUNTIME);
}
