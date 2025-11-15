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

/**
 * Calculate LLM invocation timeout
 *
 * NEW ARCHITECTURE: LLM always gets its FULL independent timeout budget,
 * regardless of attachment count or type. This ensures proper retry support
 * and prevents attachments from stealing LLM time.
 *
 * The LLM timeout is a CONSTANT - it doesn't compete with attachment processing.
 *
 * Benefits:
 * - Predictable timeout (always 480s = 8 minutes)
 * - Supports 3 retry attempts at 180s each
 * - No competition with attachment processing
 * - Simpler mental model
 *
 * @param _jobTimeout - Not used (kept for backward compatibility)
 * @param _imageCount - Not used (kept for backward compatibility)
 * @param _audioCount - Not used (kept for backward compatibility)
 * @returns Always returns TIMEOUTS.LLM_INVOCATION (480s)
 *
 * @example
 * // No attachments - LLM gets full budget
 * calculateLLMTimeout(495000, 0, 0) // 480s
 *
 * @example
 * // 5 images - LLM still gets full budget
 * calculateLLMTimeout(585000, 5, 0) // 480s
 *
 * @example
 * // Audio + images - LLM STILL gets full budget
 * calculateLLMTimeout(600000, 5, 1) // 480s
 */
export function calculateLLMTimeout(
  _jobTimeout: number,
  _imageCount: number,
  _audioCount: number
): number {
  // LLM always gets its full independent timeout budget
  return TIMEOUTS.LLM_INVOCATION; // 480s (8 minutes)
}
