/**
 * Timeout calculation utilities
 */

import { TIMEOUTS, RETRY_CONFIG } from '../config/constants.js';

/**
 * Calculate job timeout based on attachments and retry overhead
 *
 * IMPORTANT: Attachments are processed in PARALLEL (not sequential).
 * Timeout calculation accounts for:
 * - One parallel batch (slowest attachment type wins)
 * - Retry attempts for failed attachments (up to MAX_ATTEMPTS)
 * - Base time for LLM inference and system overhead
 *
 * Time breakdown:
 * - Attachment processing: One parallel batch (slowest completes)
 * - Retry overhead: Up to 3 attempts for failed attachments
 * - LLM inference: Handled separately via calculateLLMTimeout()
 * - System overhead: Queue, network, DB operations
 *
 * @param imageCount - Number of images in the request
 * @param audioCount - Number of audio/voice attachments in the request
 * @returns Timeout in milliseconds, capped at JOB_WAIT (Railway limit)
 *
 * @example
 * // No attachments
 * calculateJobTimeout(0, 0) // 120s (base only)
 *
 * @example
 * // 5 images (parallel processing)
 * calculateJobTimeout(5, 0) // 120s + 45s + 90s = 255s (NOT 5 × 45s)
 *
 * @example
 * // Mixed attachments
 * calculateJobTimeout(3, 2) // 120s + 90s + 180s = 390s → capped at 270s
 */
export function calculateJobTimeout(imageCount: number, audioCount: number = 0): number {
  // Base timeout for jobs with no attachments
  let timeout = TIMEOUTS.JOB_BASE; // 120s

  // For attachments, we process in parallel, so timeout = slowest + retries
  if (imageCount > 0 || audioCount > 0) {
    // One parallel batch (slowest wins)
    const imageBatchTime = imageCount > 0 ? TIMEOUTS.VISION_MODEL : 0;
    const audioBatchTime = audioCount > 0 ? TIMEOUTS.WHISPER_API : 0;
    const slowestBatchTime = Math.max(imageBatchTime, audioBatchTime);

    // Account for up to MAX_ATTEMPTS retry attempts (in practice, only failures retry)
    // Pessimistic: assume all attachments fail first attempts and need retries
    const retryBuffer = slowestBatchTime * (RETRY_CONFIG.MAX_ATTEMPTS - 1);

    // Add attachment time to base
    timeout = TIMEOUTS.JOB_BASE + slowestBatchTime + retryBuffer;
  }

  // Cap at Railway limit minus buffer
  return Math.min(timeout, TIMEOUTS.JOB_WAIT);
}

/**
 * Calculate how much time the LLM has for inference
 *
 * Takes the job timeout and subtracts time consumed or reserved for:
 * - Attachment processing (parallel batch)
 * - Retry overhead for failed attachments
 * - System overhead (memory, DB, queue, network)
 *
 * This ensures the LLM gets maximum available time while still
 * respecting the job timeout budget.
 *
 * @param jobTimeout - Total job timeout in milliseconds
 * @param imageCount - Number of images in the request
 * @param audioCount - Number of audio/voice attachments in the request
 * @returns LLM timeout in milliseconds (minimum 120s)
 *
 * @example
 * // No attachments (job=120s)
 * calculateLLMTimeout(120000, 0, 0) // ~105s (120s - 15s overhead)
 *
 * @example
 * // 5 images (job=255s)
 * calculateLLMTimeout(255000, 5, 0) // ~105s (255s - 45s - 90s - 15s)
 *
 * @example
 * // 1 audio (job=270s capped)
 * calculateLLMTimeout(270000, 0, 1) // 120s (minimum, audio consumes most budget)
 */
export function calculateLLMTimeout(
  jobTimeout: number,
  imageCount: number,
  audioCount: number
): number {
  // Estimate attachment processing time (parallel, pessimistic)
  const imageBatchTime = imageCount > 0 ? TIMEOUTS.VISION_MODEL : 0;
  const audioBatchTime = audioCount > 0 ? TIMEOUTS.WHISPER_API : 0;
  const slowestBatchTime = Math.max(imageBatchTime, audioBatchTime);

  // Retry buffer (if attachments fail, they'll retry)
  const retryBuffer =
    slowestBatchTime > 0 ? slowestBatchTime * (RETRY_CONFIG.MAX_ATTEMPTS - 1) : 0;

  // System overhead (memory retrieval, DB operations, queue, network)
  const systemOverhead = TIMEOUTS.SYSTEM_OVERHEAD;

  // LLM gets the rest of the budget
  const llmTimeout = Math.max(
    120000, // minimum 2 minutes (allow time for slow models)
    jobTimeout - slowestBatchTime - retryBuffer - systemOverhead
  );

  return llmTimeout;
}
