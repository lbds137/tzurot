import { describe, it, expect } from 'vitest';
import { formatEstimatedCost } from './costLine.js';
import type { EstimatedCost } from '@tzurot/common-types/schemas/api/diagnostic';

function makeCost(overrides: Partial<EstimatedCost> = {}): EstimatedCost {
  return {
    model: 'anthropic/claude-3.5-sonnet',
    promptUsd: 0.001,
    completionUsd: 0.002,
    totalUsd: 0.003,
    promptPricePerMillion: 3,
    completionPricePerMillion: 15,
    source: 'openrouter-list',
    ...overrides,
  };
}

const CAVEAT = 'OpenRouter list price; cached prompt tokens counted at full price';

describe('formatEstimatedCost', () => {
  it('renders a free-model line when BOTH per-million prices are 0', () => {
    expect(
      formatEstimatedCost(
        makeCost({
          totalUsd: 0,
          promptUsd: 0,
          completionUsd: 0,
          promptPricePerMillion: 0,
          completionPricePerMillion: 0,
        })
      )
    ).toBe('$0.0000 (free model)');
  });

  it('still renders free-model for zero prices even with nonzero token spend recorded', () => {
    // A free model can carry nonzero token counts; the prices are what make it free.
    expect(
      formatEstimatedCost(
        makeCost({
          totalUsd: 0,
          promptUsd: 0,
          completionUsd: 0,
          promptPricePerMillion: 0,
          completionPricePerMillion: 0,
          model: 'meta-llama/some-model:free',
        })
      )
    ).toBe('$0.0000 (free model)');
  });

  it('renders $0.0000 with the caveat — NOT "free model" — for a PRICED model that billed zero tokens', () => {
    // An error-path diagnostic: the model has real list prices, but promptTokens
    // and completionTokens were both 0, so the total is 0 without the model being free.
    expect(formatEstimatedCost(makeCost({ totalUsd: 0, promptUsd: 0, completionUsd: 0 }))).toBe(
      `$0.0000 (${CAVEAT})`
    );
  });

  it('renders the sub-cent placeholder for a nonzero total below the display floor', () => {
    expect(formatEstimatedCost(makeCost({ totalUsd: 0.00001 }))).toBe(
      '<$0.0001 (OpenRouter list price; cached prompt tokens counted at full price)'
    );
  });

  it('renders the 4-decimal USD figure with the caveat for a total at or above the display floor', () => {
    expect(formatEstimatedCost(makeCost({ totalUsd: 0.1234 }))).toBe(
      '$0.1234 (OpenRouter list price; cached prompt tokens counted at full price)'
    );
  });

  it('renders the priced form — NOT "free model" — when only the prompt price is 0', () => {
    expect(
      formatEstimatedCost(
        makeCost({
          promptPricePerMillion: 0,
          completionPricePerMillion: 15,
          promptUsd: 0,
          completionUsd: 0.003,
          totalUsd: 0.003,
        })
      )
    ).toBe(`$0.0030 (${CAVEAT})`);
  });

  it('renders the priced form — NOT "free model" — when only the completion price is 0', () => {
    expect(
      formatEstimatedCost(
        makeCost({
          promptPricePerMillion: 3,
          completionPricePerMillion: 0,
          promptUsd: 0.003,
          completionUsd: 0,
          totalUsd: 0.003,
        })
      )
    ).toBe(`$0.0030 (${CAVEAT})`);
  });
});
