/**
 * Retry Decision Helper
 *
 * Determines whether to retry generation based on response content.
 * Extracted from GenerationStep to maintain file size limits.
 */

import { createLogger } from '@tzurot/common-types';
import type { RAGResponse } from '../../../../services/ConversationalRAGService.js';

const logger = createLogger('RetryDecisionHelper');

/** Return type for retry decisions */
export type RetryAction = 'retry' | 'return' | 'continue';

/** Options for empty response check */
export interface EmptyResponseCheckOptions {
  response: RAGResponse;
  attempt: number;
  maxAttempts: number;
  jobId: string | undefined;
}

/** Options for duplicate detection logging */
export interface DuplicateDetectionOptions {
  response: RAGResponse;
  attempt: number;
  maxAttempts: number;
  matchIndex?: number;
  jobId?: string;
  isGuestMode: boolean;
}

/**
 * Check for empty response and determine retry action.
 *
 * @returns 'continue' if response has content, 'retry' if can retry, 'return' if exhausted
 */
export function shouldRetryEmptyResponse(opts: EmptyResponseCheckOptions): RetryAction {
  const { response, attempt, maxAttempts, jobId } = opts;

  if (response.content.length > 0) {
    return 'continue';
  }

  const canRetry = attempt < maxAttempts;
  const hasThinking = response.thinkingContent !== undefined && response.thinkingContent !== '';
  const logFn = canRetry ? logger.warn : logger.error;

  logFn(
    { jobId, attempt, modelUsed: response.modelUsed, hasThinking, totalAttempts: maxAttempts },
    canRetry
      ? '[RetryDecisionHelper] Empty response after post-processing. Retrying...'
      : '[RetryDecisionHelper] All retries produced empty responses.'
  );

  return canRetry ? 'retry' : 'return';
}

/**
 * Log duplicate detection and determine retry action.
 *
 * @returns 'retry' if can retry, 'return' if exhausted
 */
export function logDuplicateDetection(opts: DuplicateDetectionOptions): 'retry' | 'return' {
  const { response, attempt, maxAttempts, matchIndex, jobId, isGuestMode } = opts;
  const canRetry = attempt < maxAttempts;
  const logFn = canRetry ? logger.warn : logger.error;

  logFn(
    {
      jobId,
      modelUsed: response.modelUsed,
      isGuestMode,
      attempt,
      matchedTurnsBack: (matchIndex ?? 0) + 1,
    },
    canRetry
      ? '[RetryDecisionHelper] Cross-turn duplication detected. Retrying...'
      : '[RetryDecisionHelper] All retries produced duplicate responses.'
  );

  return canRetry ? 'retry' : 'return';
}
