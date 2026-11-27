import { createLogger } from '@tzurot/common-types/utils/logger';
import type { ApiKeySource } from './ApiKeyResolver.js';
import type { CreditExhaustionCache } from './CreditExhaustionCache.js';
import type { KeyInvalidCache } from './KeyInvalidCache.js';
import { deriveCacheKeyId, SYSTEM_CACHE_KEY_ID } from './RateLimitCache.js';

const logger = createLogger('effectiveTier');

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
 * Per-key health state produced from the invalid-key (401) and
 * credit-exhaustion (402) doom caches.
 */
export type KeyState = 'ok' | 'low-credit' | 'invalid';

/**
 * Translate a `ProviderRouter` / `ApiKeyResolver` key source and credential into
 * `KeyProvenance`. Provenance describes the KEY's origin, never the user's guest status.
 *
 * - Missing or empty key → `'none'`
 * - Operator system key (`source === 'system'`) → `'system'`
 * - User/BYOK wallet key (`source === 'user'`) → `'user'`
 */
export function provenanceFromResolution(
  source: ApiKeySource,
  resolvedApiKey: string | undefined
): KeyProvenance {
  if (resolvedApiKey === undefined || resolvedApiKey.length === 0) {
    return 'none';
  }
  return source === 'system' ? 'system' : 'user';
}

/**
 * Resolve the effective routing/floor tier from key provenance and key health.
 *
 * Invariant: `EffectiveTier === 'paid'` iff `keyProvenance === 'user'` and
 * `keyState` is `'ok'` (default when omitted).
 */
export function resolveEffectiveTier(input: {
  keyProvenance: KeyProvenance;
  keyState?: KeyState;
}): EffectiveTier {
  const state = input.keyState ?? 'ok';
  return input.keyProvenance === 'user' && state === 'ok' ? 'paid' : 'free';
}

/**
 * Resolve per-key health state from the invalid-key and credit-exhaustion doom
 * caches.
 *
 * Precedence: `'invalid'` wins over `'low-credit'`, otherwise `'ok'`. Both
 * non-ok states demote the tier identically to `'free'` at
 * `resolveEffectiveTier`, but callers branch on the label: AuthStep's
 * demoted-arm eligibility (`'invalid'` always; `'low-credit'` only when the
 * resolver is unwired) and `demotionAnnounce`'s footer category.
 *
 * An ACTIVE mark demotes regardless of its remaining ttl: the cache floors
 * elapsed seconds, so a mark with under a second left reads
 * `{ active, ttlSeconds: 0 }` and still demotes, matching the invoke-time
 * reader (`throwIfCreditExhausted`), which short-circuits on the same mark.
 *
 * Fail-open: an empty `cacheKeyId` or any cache read error resolves to
 * `'ok'` — never demote on a degraded cache.
 * The two cache reads are independent, so they run concurrently; only the
 * RETURNED label follows the precedence above.
 */
export async function resolveKeyState(deps: {
  cacheKeyId: string;
  caches: { creditExhaustion: CreditExhaustionCache; keyInvalid: KeyInvalidCache };
}): Promise<KeyState> {
  const { cacheKeyId, caches } = deps;
  // The caches catch and log their own Redis failures, so a rejection landing
  // here means their never-reject contract broke: trace it, still fail open.
  const failOpen = (err: unknown): null => {
    logger.warn({ err }, 'Key-state cache read rejected; failing open to ok');
    return null;
  };
  if (cacheKeyId.length === 0) {
    return 'ok';
  }
  const [invalidResult, exhaustedResult] = await Promise.all([
    caches.keyInvalid.isKeyInvalid({ cacheKeyId }).catch(failOpen),
    caches.creditExhaustion.isCreditExhausted({ cacheKeyId }).catch(failOpen),
  ]);
  if (invalidResult?.invalid === true) {
    return 'invalid';
  }
  if (exhaustedResult?.exhausted === true) {
    return 'low-credit';
  }
  return 'ok';
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
