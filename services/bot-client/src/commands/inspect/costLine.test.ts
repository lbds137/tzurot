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
    cache: null,
    ...overrides,
  };
}

const CAVEAT = 'OpenRouter list price; cached prompt tokens counted at full price';

/** Existing cases model a turn that reported cache tokens; the no-cache cases pass `false`. */
function fmt(cost: EstimatedCost, hadCacheTokens = true): string {
  return formatEstimatedCost(cost, hadCacheTokens);
}

describe('formatEstimatedCost — cache === null caveat', () => {
  it('states plain list price when the turn had no cache tokens', () => {
    expect(fmt(makeCost({ totalUsd: 0.1234, cache: null }), false)).toBe(
      '$0.1234 (OpenRouter list price)'
    );
  });

  it('keeps the full-price caveat when the turn had cache tokens', () => {
    expect(fmt(makeCost({ totalUsd: 0.1234, cache: null }), true)).toBe(`$0.1234 (${CAVEAT})`);
  });

  it('does not label a zero-priced model with cache spend as free', () => {
    expect(
      fmt(
        makeCost({
          promptPricePerMillion: 0,
          completionPricePerMillion: 0,
          totalUsd: 0.0021,
          cache: null,
        }),
        true
      )
    ).toBe(`$0.0021 (${CAVEAT})`);
  });
});

describe('formatEstimatedCost', () => {
  it('renders a free-model line when BOTH per-million prices are 0', () => {
    expect(
      fmt(
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
      fmt(
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
    expect(fmt(makeCost({ totalUsd: 0, promptUsd: 0, completionUsd: 0 }))).toBe(
      `$0.0000 (${CAVEAT})`
    );
  });

  it('renders the sub-cent placeholder for a nonzero total below the display floor', () => {
    expect(fmt(makeCost({ totalUsd: 0.00001 }))).toBe(
      '<$0.0001 (OpenRouter list price; cached prompt tokens counted at full price)'
    );
  });

  it('renders the 4-decimal USD figure with the caveat for a total at or above the display floor', () => {
    expect(fmt(makeCost({ totalUsd: 0.1234 }))).toBe(
      '$0.1234 (OpenRouter list price; cached prompt tokens counted at full price)'
    );
  });

  it('renders the priced form — NOT "free model" — when only the prompt price is 0', () => {
    expect(
      fmt(
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
      fmt(
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

describe('formatEstimatedCost — cache-aware', () => {
  const CACHE = {
    readTokens: 9334,
    writeTokens: 77,
    uncachedPromptUsd: 0.00042,
    readUsd: 0.0000933,
    writeUsd: 0.0000154,
    writeTtl: '1h' as const,
    noCacheTotalUsd: 0.0014673,
  };

  it('L1 states what the cache saved against the no-cache total', () => {
    expect(fmt(makeCost({ totalUsd: 0.000635, cache: CACHE }))).toBe(
      '$0.0006 (OpenRouter list price; cache saved $0.0008)'
    );
  });

  it('L2 states what cache writes added on a cache-filling turn, never a negative figure', () => {
    const line = fmt(
      makeCost({
        totalUsd: 0.003,
        cache: { ...CACHE, readTokens: 0, noCacheTotalUsd: 0.002 },
      })
    );
    expect(line).toBe('$0.0030 (OpenRouter list price; cache writes added $0.0010)');
    expect(line).not.toContain('-');
  });

  it('prints the plain cache-aware caveat when the cache changed nothing', () => {
    expect(fmt(makeCost({ totalUsd: 0.002, cache: { ...CACHE, noCacheTotalUsd: 0.002 } }))).toBe(
      '$0.0020 (OpenRouter list price; cache-aware)'
    );
  });

  it('treats float noise in the delta as zero when read and write prices equal the prompt price', () => {
    // Values from the gateway's computeEstimatedCost with P=54321, r=12345,
    // w=6789 and every price 2.5e-6: the parts sum to a total that differs from
    // the no-cache total by ~2.8e-17, not by a real saving.
    const totalUsd = 0.1358025;
    const noCacheTotalUsd = totalUsd + 2.7755575615628914e-17;
    expect(noCacheTotalUsd - totalUsd).toBeGreaterThan(0);
    expect(fmt(makeCost({ totalUsd, cache: { ...CACHE, noCacheTotalUsd } }))).toBe(
      '$0.1358 (OpenRouter list price; cache-aware)'
    );
    expect(
      fmt(makeCost({ totalUsd: noCacheTotalUsd, cache: { ...CACHE, noCacheTotalUsd: totalUsd } }))
    ).toBe('$0.1358 (OpenRouter list price; cache-aware)');
  });

  it('shows the NET delta on a mixed turn: reads save more than writes cost', () => {
    // read savings 0.0010 minus write premium 0.0002 = net 0.0008 saved.
    expect(fmt(makeCost({ totalUsd: 0.0092, cache: { ...CACHE, noCacheTotalUsd: 0.01 } }))).toBe(
      '$0.0092 (OpenRouter list price; cache saved $0.0008)'
    );
  });

  it('floors a tiny nonzero saving and a tiny total with the same placeholder', () => {
    expect(
      fmt(makeCost({ totalUsd: 0.00001, cache: { ...CACHE, noCacheTotalUsd: 0.00003 } }))
    ).toBe('<$0.0001 (OpenRouter list price; cache saved <$0.0001)');
  });

  it('L3 cache: null keeps the legacy caveat exactly', () => {
    expect(fmt(makeCost({ totalUsd: 0.1234, cache: null }))).toBe(`$0.1234 (${CAVEAT})`);
  });

  it('keeps the free-model branch first even with a cache block', () => {
    expect(
      fmt(
        makeCost({
          promptPricePerMillion: 0,
          completionPricePerMillion: 0,
          totalUsd: 0,
          cache: CACHE,
        })
      )
    ).toBe('$0.0000 (free model)');
  });
});
