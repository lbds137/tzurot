/**
 * Timeout calculation utilities
 */

import { TIMEOUTS } from '../constants/index.js';

/**
 * Calculate job timeout based on INDEPENDENT component budgets
 *
 * NEW ARCHITECTURE: Each component gets its own independent timeout budget.
 * The job timeout is the SUM of component timeouts, not a zero-sum allocation.
 *
 * Component breakdown (all independent):
 * - Attachment processing: Parallel batch (slowest wins: audio=210s, image=90s)
 * - LLM invocation: Always gets full 480s budget regardless of attachments
 * - System overhead: 15s for DB, queue, network operations
 *
 * Total = max(attachment processing) + LLM invocation + overhead
 *
 * Benefits:
 * - LLM always gets 480s (8 min) for retries
 * - Attachments don't steal LLM time
 * - Predictable component timeouts
 * - Supports proper retry budgets
 *
 * @param imageCount - Number of images in the request
 * @param audioCount - Number of audio/voice attachments in the request
 * @returns Timeout in milliseconds, capped at JOB_WAIT (Railway limit)
 *
 * @example
 * // No attachments: overhead + LLM
 * calculateJobTimeout(0, 0) // 15s + 480s = 495s
 *
 * @example
 * // 5 images (parallel): image + LLM + overhead
 * calculateJobTimeout(5, 0) // 90s + 480s + 15s = 585s
 *
 * @example
 * // 1 audio: audio + LLM + overhead
 * calculateJobTimeout(0, 1) // 210s + 480s + 15s = 705s (capped at 600s)
 */
export function calculateJobTimeout(imageCount: number, audioCount: number = 0): number {
  let timeout = TIMEOUTS.SYSTEM_OVERHEAD; // 15s

  // Attachment processing time (components run in parallel, use slowest)
  const imageProcessingTime = imageCount > 0 ? TIMEOUTS.VISION_MODEL : 0; // 90s
  // Audio requires download + transcription
  const audioProcessingTime = audioCount > 0 ? TIMEOUTS.AUDIO_FETCH + TIMEOUTS.WHISPER_API : 0; // 210s
  const attachmentTime = Math.max(imageProcessingTime, audioProcessingTime);

  // Add LLM invocation time (INDEPENDENT of attachment processing)
  timeout += attachmentTime + TIMEOUTS.LLM_INVOCATION; // Always add full 480s

  // Cap at Railway limit (10 minutes)
  return Math.min(timeout, TIMEOUTS.JOB_WAIT);
}

