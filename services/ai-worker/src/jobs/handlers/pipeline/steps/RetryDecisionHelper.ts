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

  // NOTE: Do NOT extract logger methods (e.g., const logFn = logger.warn) as this loses
  // the `this` context and causes "Cannot read properties of undefined" pino errors.
  // Also, ESLint requires inline object literals for logger calls.
  if (canRetry) {
    logger.warn(
      { jobId, attempt, modelUsed: response.modelUsed, hasThinking, totalAttempts: maxAttempts },
      '[RetryDecisionHelper] Empty response after post-processing. Retrying...'
    );
  } else {
    logger.error(
      { jobId, attempt, modelUsed: response.modelUsed, hasThinking, totalAttempts: maxAttempts },
      '[RetryDecisionHelper] All retries produced empty responses.'
    );
  }

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
  const matchedTurnsBack = (matchIndex ?? 0) + 1;

  // NOTE: Do NOT extract logger methods (e.g., const logFn = logger.warn) as this loses
  // the `this` context and causes "Cannot read properties of undefined" pino errors.
  // Also, ESLint requires inline object literals for logger calls.
  if (canRetry) {
    logger.warn(
      { jobId, modelUsed: response.modelUsed, isGuestMode, attempt, matchedTurnsBack },
      '[RetryDecisionHelper] Cross-turn duplication detected. Retrying...'
    );
  } else {
    logger.error(
      { jobId, modelUsed: response.modelUsed, isGuestMode, attempt, matchedTurnsBack },
      '[RetryDecisionHelper] All retries produced duplicate responses.'
    );
  }

  return canRetry ? 'retry' : 'return';
}
