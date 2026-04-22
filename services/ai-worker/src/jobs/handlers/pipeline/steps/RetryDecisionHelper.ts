/**
 * Retry Decision Helper
 *
 * Determines whether to retry generation based on response content.
 * Extracted from GenerationStep to maintain file size limits.
 */

import { createLogger } from '@tzurot/common-types';
import type { RAGResponse } from '../../../../services/ConversationalRAGTypes.js';

const logger = createLogger('RetryDecisionHelper');

/** Return type for retry decisions */
type RetryAction = 'retry' | 'return' | 'continue';

/** A rejected-but-valid response preserved as a fallback in case later attempts fail entirely */
export interface FallbackResponse {
  response: RAGResponse;
  reason: 'empty' | 'duplicate' | 'leaked-thinking';
  attempt: number;
}

/**
 * Fallback quality ranking: duplicate > leaked-thinking > empty.
 * - duplicate: in-character content, just repeated
 * - leaked-thinking: has content, just wrong kind (raw CoT)
 * - empty: no content at all
 */
const FALLBACK_RANK: Record<FallbackResponse['reason'], number> = {
  duplicate: 2,
  'leaked-thinking': 1,
  empty: 0,
};

/**
 * Select the better fallback between existing and candidate.
 * Uses quality ranking (duplicate > leaked-thinking > empty).
 * At equal rank, prefers the more recent attempt (escalated params).
 */
export function selectBetterFallback(
  existing: FallbackResponse | undefined,
  candidate: FallbackResponse
): FallbackResponse {
  if (existing === undefined) {
    return candidate;
  }
  const existingRank = FALLBACK_RANK[existing.reason];
  const candidateRank = FALLBACK_RANK[candidate.reason];
  if (existingRank > candidateRank) {
    return existing;
  }
  if (candidateRank > existingRank) {
    return candidate;
  }
  // Same rank: prefer the more recent attempt (later attempt had escalated params)
  return candidate;
}

/**
 * Log when a fallback response is used after a later LLM invocation failed.
 */
export function logFallbackUsed(fallback: FallbackResponse, jobId: string | undefined): void {
  logger.warn(
    {
      jobId,
      fallbackReason: fallback.reason,
      fallbackAttempt: fallback.attempt,
      modelUsed: fallback.response.modelUsed,
    },
    'Using fallback response from earlier attempt after LLM failure'
  );
}

/** Retry config shape (subset needed for logging) */
interface RetryConfigForLog {
  temperatureOverride?: number;
  frequencyPenaltyOverride?: number;
  historyReductionPercent?: number;
}

/** Log escalating retry parameters when attempt > 1 */
export function logRetryEscalation(
  jobId: string | undefined,
  attempt: number,
  retryConfig: RetryConfigForLog
): void {
  if (attempt <= 1) {
    return;
  }
  logger.info(
    {
      jobId,
      attempt,
      temperatureOverride: retryConfig.temperatureOverride,
      frequencyPenaltyOverride: retryConfig.frequencyPenaltyOverride,
      historyReductionPercent: retryConfig.historyReductionPercent,
    },
    'Escalating retry parameters'
  );
}

/** Log when a retry succeeds after previous failures */
export function logRetrySuccess(opts: {
  jobId: string | undefined;
  modelUsed: string | undefined;
  attempt: number;
  duplicateRetries: number;
  emptyRetries: number;
  leakedThinkingRetries: number;
}): void {
  logger.info({ ...opts }, 'Retry succeeded - got valid unique response');
}

/** Options for empty response check */
interface EmptyResponseCheckOptions {
  response: RAGResponse;
  attempt: number;
  maxAttempts: number;
  jobId: string | undefined;
}

/** Options for duplicate detection logging */
interface DuplicateDetectionOptions {
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
      'Empty response after post-processing. Retrying...'
    );
  } else {
    logger.error(
      { jobId, attempt, modelUsed: response.modelUsed, hasThinking, totalAttempts: maxAttempts },
      'All retries produced empty responses.'
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
      'Cross-turn duplication detected. Retrying...'
    );
  } else {
    logger.error(
      { jobId, modelUsed: response.modelUsed, isGuestMode, attempt, matchedTurnsBack },
      'All retries produced duplicate responses.'
    );
  }

  return canRetry ? 'retry' : 'return';
}
