import { describe, it, expect } from 'vitest';
import { truncateAtWordBoundary, ATTACHMENT_SEARCH_BUDGET_CHARS } from './searchQueryBudget.js';

describe('truncateAtWordBoundary', () => {
  it('returns short text unchanged', () => {
    expect(truncateAtWordBoundary('short', 100)).toBe('short');
  });

  it('cuts at the last word boundary inside the budget', () => {
    expect(truncateAtWordBoundary('alpha beta gamma delta', 17)).toBe('alpha beta gamma');
  });

  it('cuts hard when the only boundary sacrifices over half the budget', () => {
    const text = `ab ${'x'.repeat(50)}`;
    expect(truncateAtWordBoundary(text, 20)).toBe(text.slice(0, 20));
  });

  it('treats newlines as boundaries', () => {
    expect(truncateAtWordBoundary('alpha beta\ngamma delta', 17)).toBe('alpha beta\ngamma');
  });

  it('does not leave a lone surrogate when the hard cut lands mid-emoji', () => {
    // 40 chars of unbroken emoji (2 UTF-16 units each); an odd cap forces the
    // hard-cut path to land between a surrogate pair's halves.
    const text = '😀'.repeat(20);
    const cut = truncateAtWordBoundary(text, 21);
    expect(cut).toBe('😀'.repeat(10));
    expect(/[\uD800-\uDBFF]$/.test(cut)).toBe(false);
  });

  it('never exceeds the budget', () => {
    const text = 'word '.repeat(500);
    expect(truncateAtWordBoundary(text, ATTACHMENT_SEARCH_BUDGET_CHARS).length).toBeLessThanOrEqual(
      ATTACHMENT_SEARCH_BUDGET_CHARS
    );
  });
});

describe('ATTACHMENT_SEARCH_BUDGET_CHARS', () => {
  it('is half the 512-token window at ~4 chars/token', () => {
    // The policy the A/B validated: attachment text gets at most half the
    // embedder window, leaving the other half for the user message and the
    // referenced-message text that used to be starved out entirely.
    expect(ATTACHMENT_SEARCH_BUDGET_CHARS).toBe((512 / 2) * 4);
  });
});
