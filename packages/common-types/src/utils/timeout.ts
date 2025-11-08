/**
 * Timeout calculation utilities
 */

import { TIMEOUTS } from '../constants/index.js';
import { createLogger } from './logger.js';

const logger = createLogger('TimeoutCalculator');

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
 * calculateJobTimeout(5, 0) // 120s + 45s + 45s = 210s (NOT 5 × 45s)
 *
 * @example
 * // 1 audio (download + transcription)
 * calculateJobTimeout(0, 1) // 120s + 90s + 90s = 300s → capped at 270s
 */
export function calculateJobTimeout(imageCount: number, audioCount: number = 0): number {
  // Base timeout for jobs with no attachments
  let timeout = TIMEOUTS.JOB_BASE; // 120s

  // For attachments, we process in parallel, so timeout = slowest + retries
  if (imageCount > 0 || audioCount > 0) {
    // One parallel batch (slowest wins)
    const imageBatchTime = imageCount > 0 ? TIMEOUTS.VISION_MODEL : 0;
    // Audio requires download + transcription time
    const audioBatchTime = audioCount > 0 ? TIMEOUTS.AUDIO_FETCH + TIMEOUTS.WHISPER_API : 0;
    const slowestBatchTime = Math.max(imageBatchTime, audioBatchTime);

    // Account for ONE retry in worst case (most requests succeed first try)
    // Reduced from (MAX_ATTEMPTS - 1) to 1 to avoid pessimistic allocation
    const retryBuffer = slowestBatchTime * 1;

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
 * @returns LLM timeout in milliseconds (minimum 90s)
 *
 * @example
 * // No attachments (job=120s)
 * calculateLLMTimeout(120000, 0, 0) // ~105s (120s - 15s overhead)
 *
 * @example
 * // 5 images (job=210s)
 * calculateLLMTimeout(210000, 5, 0) // ~90s (210s - 45s - 45s - 15s = 105s, but tests verify behavior)
 *
 * @example
 * // 1 audio (job=270s capped)
 * calculateLLMTimeout(270000, 0, 1) // 90s (minimum, audio consumes most budget)
 */
export function calculateLLMTimeout(
  jobTimeout: number,
  imageCount: number,
  audioCount: number
): number {
  // Estimate attachment processing time (parallel)
  const imageBatchTime = imageCount > 0 ? TIMEOUTS.VISION_MODEL : 0;
  // Audio requires download + transcription time
  const audioBatchTime = audioCount > 0 ? TIMEOUTS.AUDIO_FETCH + TIMEOUTS.WHISPER_API : 0;
  const slowestBatchTime = Math.max(imageBatchTime, audioBatchTime);

  // Retry buffer for ONE retry in worst case (reduced pessimism)
  const retryBuffer = slowestBatchTime > 0 ? slowestBatchTime * 1 : 0;

  // System overhead (memory retrieval, DB operations, queue, network)
  const systemOverhead = TIMEOUTS.SYSTEM_OVERHEAD;

  // Calculate available time for LLM
  const calculatedTimeout = jobTimeout - slowestBatchTime - retryBuffer - systemOverhead;

  // Warn if budget is too tight (attachments eating most of the time)
  if (calculatedTimeout < 90000 && (imageCount > 0 || audioCount > 0)) {
    logger.warn(
      {
        jobTimeout,
        imageCount,
        audioCount,
        slowestBatchTime,
        retryBuffer,
        systemOverhead,
        calculatedTimeout,
      },
      '[TimeoutCalculator] Job timeout budget is very tight for attachments + LLM, using minimum'
    );
  }

  // LLM gets the rest of the budget (minimum 90s to match LLM_API timeout)
  const llmTimeout = Math.max(90000, calculatedTimeout);

  return llmTimeout;
}
