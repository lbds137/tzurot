import { describe, expect, it } from 'vitest';
import { selectFacts, FACT_BUDGET_MAX_TOKENS, FACT_BUDGET_MAX_FRACTION } from './factBudget.js';
import type { FactForPrompt } from './ConversationalRAGTypes.js';

/** A trivial deterministic counter: every fact/wrapper text costs 100 tokens
 *  regardless of content, so tests can reason about token math by count alone
 *  rather than tying assertions to `formatSingleFact`'s real output length. */
function fixedCost(cost: number): (text: string) => number {
  return () => cost;
}

function fact(statement: string): FactForPrompt {
  return { statement };
}

describe('selectFacts', () => {
  it('zero facts selects nothing and spends zero tokens', () => {
    const result = selectFacts([], 1000, fixedCost(100));
    expect(result).toEqual({ selectedFacts: [], factTokensUsed: 0 });
  });

  it('greedily fills up to the cap, stopping before the entry that would overflow it', () => {
    // Wrapper (100) + 3 facts (100 each) = 400 total if all fit; budget slice
    // below is 300, so only 2 of 3 facts (100+100+100=300) fit.
    const facts = [fact('a'), fact('b'), fact('c')];
    const result = selectFacts(facts, 1000, fixedCost(100), undefined);
    // memoryBudget 1000 * FACT_BUDGET_MAX_FRACTION (0.3) = 300, under the
    // FACT_BUDGET_MAX_TOKENS (600) cap, so the slice is 300.
    expect(result.selectedFacts).toHaveLength(2);
    expect(result.factTokensUsed).toBe(300);
  });

  it('the wrapper overhead is counted exactly once, not per fact', () => {
    const facts = [fact('a')];
    const result = selectFacts(facts, 10_000, fixedCost(50));
    // Slice = min(600, 10000*0.3=3000) = 600. Wrapper(50) + fact(50) = 100.
    expect(result.selectedFacts).toHaveLength(1);
    expect(result.factTokensUsed).toBe(100);
  });

  it('wrapper overhead alone exceeding the slice selects nothing (zero facts, zero tokens)', () => {
    const facts = [fact('a'), fact('b')];
    // memoryBudget small enough that even the wrapper overhead overflows the slice.
    const result = selectFacts(facts, 10, fixedCost(100));
    expect(result).toEqual({ selectedFacts: [], factTokensUsed: 0 });
  });

  it('caps the slice at FACT_BUDGET_MAX_TOKENS even with a huge memory budget', () => {
    const facts = Array.from({ length: 20 }, (_, i) => fact(`fact-${i}`));
    const result = selectFacts(facts, 1_000_000, fixedCost(50));
    // Slice = min(600, 1_000_000*0.3) = 600. Wrapper(50) + N*50 <= 600 → N <= 11.
    const expectedCount = Math.floor((FACT_BUDGET_MAX_TOKENS - 50) / 50);
    expect(result.selectedFacts).toHaveLength(expectedCount);
    expect(FACT_BUDGET_MAX_FRACTION).toBe(0.3);
  });
});
