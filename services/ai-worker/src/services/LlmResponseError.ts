/**
 * Typed LLM response-shape failure.
 *
 * `LLMInvoker.invokeSingleAttempt` throws this when a provider answered but
 * the answer is unusable — a provider-error finish reason, empty content, or
 * a censored stub. The invoker classifies all three as retryable and lets
 * `withRetry` re-enter the model, so the failure carries no user-facing
 * meaning on its own; what it needs to carry is ATTRIBUTION.
 *
 * The persisted diagnostic record `/inspect` reads is composed far from the
 * response — at the `RetryError` boundary in `composeGenerationFailureResult`
 * — so the response's own routed-model and finish-reason data has no other
 * way to reach it than riding the thrown error. And for a router alias (e.g.
 * `openrouter/auto`) the requested model name IS the alias: only the
 * response's reported model names what actually produced the failing
 * generation.
 */
export class LlmResponseError extends Error {
  /**
   * Model id the provider reported having served for the failed response,
   * when the response carried one. Undefined when the payload omitted the
   * field (a non-OpenRouter route, or a route that doesn't report it).
   */
  readonly routedModel?: string;

  /** The finish reason the failing response carried. */
  readonly finishReason?: string;

  constructor(message: string, options?: { routedModel?: string; finishReason?: string }) {
    super(message);
    this.name = 'LlmResponseError';
    this.routedModel = options?.routedModel;
    this.finishReason = options?.finishReason;
  }
}
