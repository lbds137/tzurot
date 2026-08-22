/**
 * Fact Budget
 *
 * Selection of retrieved facts within the reserved fact sub-budget. Extracted
 * out of `ContentBudgetManager` purely for size — that file sat at the
 * `max-lines` ceiling and this selection has no other reason to live
 * separately from its caller (the same reason `context/shippedHistoryMessages.ts`
 * was extracted).
 */

import {
  formatSingleFact,
  getFactsWrapperOverheadText,
  type FactRenderNames,
} from './prompt/MemoryFormatter.js';
import type { FactForPrompt } from './ConversationalRAGTypes.js';

/**
 * Reserved fact sub-budget (Phase 2 slice 4a). Facts are short/dense and would
 * otherwise crowd verbose episodes out of the shared memory budget (council).
 * They get a capped slice — at most `FACT_BUDGET_MAX_TOKENS`, and never more
 * than `FACT_BUDGET_MAX_FRACTION` of the memory budget — so episodes always
 * keep the majority; the rest of the memory budget goes to episodes.
 */
export const FACT_BUDGET_MAX_TOKENS = 600;
export const FACT_BUDGET_MAX_FRACTION = 0.3;

/**
 * Select facts within the reserved fact sub-budget (capped fraction of the
 * memory budget). Greedy by retrieval order (already sorted by
 * distance→recency→salience), counting the `<facts>` wrapper overhead so the
 * block never overflows its slice. Zero facts selected → zero tokens (the
 * empty block renders nothing).
 */
export function selectFacts(
  facts: FactForPrompt[],
  memoryBudget: number,
  countTokens: (text: string) => number,
  names?: FactRenderNames
): { selectedFacts: FactForPrompt[]; factTokensUsed: number } {
  if (facts.length === 0) {
    return { selectedFacts: [], factTokensUsed: 0 };
  }
  const factBudget = Math.min(
    FACT_BUDGET_MAX_TOKENS,
    Math.floor(memoryBudget * FACT_BUDGET_MAX_FRACTION)
  );
  // Same names the render path uses — the overhead count and the per-fact
  // counts must be of the same text the render emits (placeholder-resolved).
  const wrapperOverhead = countTokens(getFactsWrapperOverheadText(names?.subjectName));
  const selected: FactForPrompt[] = [];
  let used = wrapperOverhead;
  for (const fact of facts) {
    const factTokens = countTokens(formatSingleFact(fact, names));
    if (used + factTokens > factBudget) {
      break;
    }
    selected.push(fact);
    used += factTokens;
  }
  return selected.length > 0
    ? { selectedFacts: selected, factTokensUsed: used }
    : { selectedFacts: [], factTokensUsed: 0 };
}
