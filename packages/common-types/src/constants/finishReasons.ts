/**
 * Finish Reason Constants
 *
 * Standardized values for LLM response completion status.
 * Different providers use different field names and values:
 * - OpenAI/OpenRouter: finish_reason
 * - Anthropic: stop_reason
 * - Google: finishReason (camelCase)
 */

/**
 * Known finish reason values from LLM providers
 */
export const FINISH_REASONS = {
  /** Natural completion - OpenAI/OpenRouter */
  STOP: 'stop',
  /** Natural completion - Anthropic */
  END_TURN: 'end_turn',
  /** Natural completion - Google (uppercase) */
  STOP_GOOGLE: 'STOP',
  /** Response truncated due to token limit */
  LENGTH: 'length',
  /** A configured stop sequence was triggered */
  STOP_SEQUENCE: 'stop_sequence',
  /** Content filter blocked the response */
  CONTENT_FILTER: 'content_filter',
  /** Default sentinel when finish reason is unavailable */
  UNKNOWN: 'unknown',
} as const;

/** Known finish reason value */
export type FinishReason = (typeof FINISH_REASONS)[keyof typeof FINISH_REASONS];

/**
 * Check if a finish reason indicates natural/successful completion.
 * Providers use different values for the same concept:
 * - OpenAI/OpenRouter: 'stop'
 * - Anthropic: 'end_turn'
 * - Google: 'STOP'
 */
export function isNaturalStop(finishReason: string): boolean {
  return (
    finishReason === FINISH_REASONS.STOP ||
    finishReason === FINISH_REASONS.END_TURN ||
    finishReason === FINISH_REASONS.STOP_GOOGLE
  );
}

/**
 * Extract finish reason from LLM provider response metadata.
 * Handles the different field names used by each provider:
 * - OpenAI/OpenRouter: finish_reason
 * - Anthropic: stop_reason
 * - Google: finishReason (camelCase)
 *
 * @param metadata - Raw response metadata (Record<string, unknown> from LangChain)
 * @returns The finish reason string, or FINISH_REASONS.UNKNOWN if not found
 */
export function resolveFinishReason(metadata: Record<string, unknown> | null | undefined): string {
  if (metadata === null || metadata === undefined) {
    return FINISH_REASONS.UNKNOWN;
  }
  const raw = metadata.finish_reason ?? metadata.stop_reason ?? metadata.finishReason;
  return typeof raw === 'string' ? raw : FINISH_REASONS.UNKNOWN;
}
