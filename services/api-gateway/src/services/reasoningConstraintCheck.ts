/**
 * Reasoning-budget sanity check for LLM config `advancedParameters`.
 *
 * `reasoning.max_tokens >= max_tokens` means the reasoning budget would consume
 * the entire token allowance, leaving no room for the actual response. We WARN
 * rather than reject on save: an existing config may already violate this
 * (rejecting would block an unrelated edit to it), and OpenRouter may clamp the
 * budget anyway — but a silent misconfiguration truncates output with no signal,
 * so surfacing it in the logs is the useful middle ground.
 */
import {
  safeValidateAdvancedParams,
  hasReasoningEnabled,
  validateReasoningConstraints,
} from '@tzurot/common-types/schemas/llmAdvancedParams';

/** Minimal structural logger — matches the pino logger's `warn(obj, msg)`. */
interface WarnLogger {
  warn: (obj: Record<string, unknown>, msg: string) => void;
}

/**
 * If `advancedParameters` enable reasoning with a budget that leaves no room for
 * the response (`reasoning.max_tokens >= max_tokens`), return the offending
 * values for logging; otherwise `null`. Pure — the caller decides what to do.
 */
export function reasoningConstraintViolation(
  advancedParameters: unknown
): { reasoningMaxTokens: number; maxTokens: number } | null {
  const params = safeValidateAdvancedParams(advancedParameters);
  if (params === null) {
    return null; // unparseable — the read path coerces to {}
  }
  if (!hasReasoningEnabled(params)) {
    return null;
  }
  if (validateReasoningConstraints(params)) {
    return null;
  }
  // Constraint violated ⇒ both values are defined (validateReasoningConstraints
  // returns valid when either is undefined); the `?? 0` guards are unreachable.
  return {
    reasoningMaxTokens: params.reasoning?.max_tokens ?? 0,
    maxTokens: params.max_tokens ?? 0,
  };
}

/** Warn (never reject) when the reasoning budget leaves no room for the response. */
export function warnOnReasoningConstraintViolation(
  logger: WarnLogger,
  context: { configId: string },
  advancedParameters: unknown
): void {
  const violation = reasoningConstraintViolation(advancedParameters);
  if (violation === null) {
    return;
  }
  logger.warn(
    { ...context, ...violation },
    'LLM config saved with reasoning.max_tokens >= max_tokens; reasoning may leave no room for the response'
  );
}
