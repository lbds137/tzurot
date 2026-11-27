import { deriveCacheKeyId, SYSTEM_CACHE_KEY_ID } from './RateLimitCache.js';

/**
 * Effective capability and routing tier for an authenticated LLM invocation.
 *
 * `'paid'` requires a valid user-owned (BYOK) key (`keyProvenance === 'user'`
 * with `keyState` `'ok'` or omitted). Every other provenance or degraded key
 * state resolves to `'free'`.
 */
export type EffectiveTier = 'paid' | 'free';

/**
 * Origin of the API key resolved for the current invocation.
 *
 * - `'user'`: personal wallet / BYOK key supplied by the user
 * - `'system'`: operator system/env key (guest fallback or system-key mode)
 * - `'none'`: no API key resolved (local/Ollama route or keyless failure)
 */
export type KeyProvenance = 'user' | 'system' | 'none';

/**
 * Resolve the effective routing/floor tier from key provenance and key health.
 *
 * Invariant: `EffectiveTier === 'paid'` iff `keyProvenance === 'user'` and
 * `keyState` is `'ok'` (default when omitted).
 */
export function resolveEffectiveTier(input: {
  keyProvenance: KeyProvenance;
  keyState?: 'ok' | 'low-credit' | 'invalid';
}): EffectiveTier {
  const state = input.keyState ?? 'ok';
  return input.keyProvenance === 'user' && state === 'ok' ? 'paid' : 'free';
}

/**
 * Derive the rate-limit and quota-exhaustion cache key ID from key provenance.
 *
 * Invariant (D10 firewall): only `keyProvenance === 'user'` produces a
 * per-user cache bucket (`user:<userId>`); `'system'` and `'none'` always
 * map to `SYSTEM_CACHE_KEY_ID` (`'system'`) regardless of `isGuestMode`.
 */
export function authCacheKeyId(
  auth: { keyProvenance: KeyProvenance },
  resolvedApiKey: string | undefined,
  userId: string
): string {
  if (auth.keyProvenance !== 'user') {
    return SYSTEM_CACHE_KEY_ID;
  }
  return deriveCacheKeyId(resolvedApiKey, userId, false);
}
