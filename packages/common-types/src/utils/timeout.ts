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
 * calculateTimeoutWithRetries(210000, 3) // 633000ms (633s)
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
 * - Audio processing: (30s fetch + 180s whisper) × 3 attempts + delays = 633s
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
 * @returns Timeout in milliseconds, capped at WORKER_LOCK_DURATION (20 min safety net)
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
 * // 1 audio: audio with retries + LLM + overhead
 * calculateJobTimeout(0, 1) // 633s + 480s + 15s = 1128s (capped at 1200s)
 */
export function calculateJobTimeout(imageCount: number, audioCount = 0): number {
  let timeout = TIMEOUTS.SYSTEM_OVERHEAD; // 15s

  // Attachment processing time WITH RETRIES (components run in parallel, use slowest)
  // Images: 90s per attempt × 3 attempts + backoff delays (1s + 2s) = 273s
  const imageProcessingTime =
    imageCount > 0 ? calculateTimeoutWithRetries(TIMEOUTS.VISION_MODEL) : 0;

  // Audio: (30s fetch + 180s whisper) per attempt × 3 attempts + backoff delays = 633s
  const audioProcessingTime =
    audioCount > 0 ? calculateTimeoutWithRetries(TIMEOUTS.AUDIO_FETCH + TIMEOUTS.WHISPER_API) : 0;

  const attachmentTime = Math.max(imageProcessingTime, audioProcessingTime);

  // Add LLM invocation time (INDEPENDENT of attachment processing)
  // LLM_INVOCATION already includes retry budget (480s total)
  timeout += attachmentTime + TIMEOUTS.LLM_INVOCATION;

  // Cap at worker lock duration (20 minutes - safety net)
  return Math.min(timeout, TIMEOUTS.WORKER_LOCK_DURATION);
}
