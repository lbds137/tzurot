/**
 * Redis cache-key prefixes shared by services and ops tooling. Centralised
 * here so a rename can't silently desync the runtime cache writer from the
 * operator `DEL` tooling — the previous duplication had no compile-time
 * signal that the two literals had to match.
 *
 * Every prefix ends with `:` so callers concatenate the dynamic identifier
 * directly. The `cacheKeyId` segment follows its producer's no-colon
 * invariant — see `RateLimitCache.assertValidCacheKeyId` for the
 * runtime-enforced grammar. List every reader/writer in a `<consumer>` doc
 * line when adding a prefix.
 */
export const CACHE_KEY_PREFIXES = {
  /**
   * Per-(account, model) rate-limit window cache for OpenRouter 429s.
   * Consumers: `ai-worker/RateLimitCache`.
   */
  RATE_LIMIT_OPENROUTER: 'ratelimit:openrouter:',
  /**
   * Per-account credit-exhaustion cache for OpenRouter 402s.
   * Consumers: `ai-worker/CreditExhaustionCache`, `tooling/cache/clear-credit-exhaustion`.
   */
  CREDIT_EXHAUSTION_OPENROUTER: 'nocredits:openrouter:',
} as const;
