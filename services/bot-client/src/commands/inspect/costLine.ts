/**
 * Format an estimated diagnostic cost for the inspect embed's Response field.
 *
 * The cost is always OpenRouter's LIST price at read time, never a billed
 * amount — see `services/api-gateway/src/services/diagnosticCost.ts` for the
 * computation. `cachedPromptTokens` is deliberately unused here: it is not
 * folded into the estimate, so the caveat text always says cached prompt
 * tokens are counted at full price.
 */

import type { EstimatedCost } from '@tzurot/common-types/schemas/api/diagnostic';

const LIST_PRICE_CAVEAT = 'OpenRouter list price; cached prompt tokens counted at full price';

/**
 * Below this, a NONZERO total renders as "<$0.0001" rather than a misleadingly
 * precise figure. An exact zero is excluded: on a priced model it means zero
 * tokens were billed, which `$0.0000` states accurately and `<$0.0001` does not.
 */
const MIN_DISPLAYED_USD = 0.00005;

export function formatEstimatedCost(cost: EstimatedCost): string {
  // "Free" is a property of the PRICES, not the total: a priced model billed
  // for zero tokens (an error-path diagnostic that never consumed any) also
  // totals zero, and labelling that "free model" would misreport the model.
  if (cost.promptPricePerMillion === 0 && cost.completionPricePerMillion === 0) {
    return '$0.0000 (free model)';
  }
  if (cost.totalUsd > 0 && cost.totalUsd < MIN_DISPLAYED_USD) {
    return `<$0.0001 (${LIST_PRICE_CAVEAT})`;
  }
  return `$${cost.totalUsd.toFixed(4)} (${LIST_PRICE_CAVEAT})`;
}
