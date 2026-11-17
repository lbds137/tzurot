/**
 * Format an estimated diagnostic cost for the inspect embed's Response field.
 *
 * The cost is always OpenRouter's LIST price at read time, never a billed
 * amount — see `services/api-gateway/src/services/diagnosticCost.ts` for the
 * computation. When the estimate carries a `cache` block, cache reads, cache
 * writes and uncached prompt tokens were priced at their own rates, and the
 * line states what the cache saved (or, on a cache-filling turn, added)
 * against the same tokens with no cache. With `cache === null` every prompt
 * token was priced at the prompt rate, and the caveat says so.
 */

import type { EstimatedCost } from '@tzurot/common-types/schemas/api/diagnostic';

const LIST_PRICE_CAVEAT = 'OpenRouter list price; cached prompt tokens counted at full price';
const NO_CACHE_CAVEAT = 'OpenRouter list price';

/**
 * Below this, a NONZERO amount renders as "<$0.0001" rather than a misleadingly
 * precise figure. An exact zero is excluded: on a priced model it means zero
 * tokens were billed, which `$0.0000` states accurately and `<$0.0001` does not.
 */
const MIN_DISPLAYED_USD = 0.00005;

/**
 * One USD amount, shared by the total and the cache delta; callers pass
 * usd >= 0. That holds because the delta is negated before the call on the
 * writes-added path, and totals are non-negative: the gateway rejects negative
 * prices and token counts (`isUsablePrice`, `isTokenCount` in api-gateway's
 * diagnosticCost.ts).
 */
function amount(usd: number): string {
  if (usd > 0 && usd < MIN_DISPLAYED_USD) {
    return '<$0.0001';
  }
  return `$${usd.toFixed(4)}`;
}

/** Relative size under which a cache delta is floating-point noise, not a difference. */
const DELTA_NOISE_RATIO = 1e-9;

/**
 * Caveat for a cache-aware estimate; the delta is never printed negative.
 * The delta is NET: read savings minus the write premium, so a mixed turn
 * (reads and writes) shows its net as "saved" or "added". A delta within
 * float noise of zero counts as zero ("cache-aware" wording).
 */
function cacheCaveat(cache: NonNullable<EstimatedCost['cache']>, totalUsd: number): string {
  const delta = cache.noCacheTotalUsd - totalUsd;
  const noise = DELTA_NOISE_RATIO * Math.max(cache.noCacheTotalUsd, totalUsd);
  if (delta > noise) {
    return `OpenRouter list price; cache saved ${amount(delta)}`;
  }
  if (delta < -noise) {
    return `OpenRouter list price; cache writes added ${amount(-delta)}`;
  }
  return 'OpenRouter list price; cache-aware';
}

/**
 * `hadCacheTokens` says whether the turn reported any cache reads or writes;
 * with `cache === null` it picks between the full-price caveat (cache tokens
 * existed but were counted at the prompt rate) and the plain list-price one.
 */
export function formatEstimatedCost(cost: EstimatedCost, hadCacheTokens: boolean): string {
  // "Free" is a property of the PRICES, not the total: a priced model billed
  // for zero tokens (an error-path diagnostic that never consumed any) also
  // totals zero, and labelling that "free model" would misreport the model.
  // A zero-priced prompt/completion model can still carry nonzero cache
  // spend, so the total must be zero too.
  if (
    cost.promptPricePerMillion === 0 &&
    cost.completionPricePerMillion === 0 &&
    cost.totalUsd === 0
  ) {
    return '$0.0000 (free model)';
  }
  const listCaveat = hadCacheTokens ? LIST_PRICE_CAVEAT : NO_CACHE_CAVEAT;
  const caveat = cost.cache === null ? listCaveat : cacheCaveat(cost.cache, cost.totalUsd);
  return `${amount(cost.totalUsd)} (${caveat})`;
}
