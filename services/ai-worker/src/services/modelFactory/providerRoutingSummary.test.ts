import { describe, expect, it } from 'vitest';

import { summarizeProviderRouting } from './providerRoutingSummary.js';

describe('summarizeProviderRouting', () => {
  it('summarizes the only shape (pin): host count + scalars, no host list', () => {
    expect(
      summarizeProviderRouting({
        only: ['z-ai', 'fireworks', 'together'],
        allow_fallbacks: false,
        data_collection: 'deny',
      })
    ).toStrictEqual({
      shape: 'only',
      hostCount: 3,
      allowFallbacks: false,
      dataCollection: 'deny',
    });
  });

  it('summarizes the ignore shape: hostCount from ignore, allowFallbacks undefined', () => {
    expect(
      summarizeProviderRouting({ ignore: ['minimax', 'atlas-cloud'], data_collection: 'deny' })
    ).toStrictEqual({
      shape: 'ignore',
      hostCount: 2,
      allowFallbacks: undefined,
      dataCollection: 'deny',
    });
  });

  it('summarizes an absent routing object as shape none', () => {
    expect(summarizeProviderRouting(undefined)).toStrictEqual({
      shape: 'none',
      hostCount: 0,
      allowFallbacks: undefined,
      dataCollection: undefined,
    });
  });

  it('summarizes a routing object with neither list as shape none (hostCount 0)', () => {
    expect(summarizeProviderRouting({ data_collection: 'deny' })).toStrictEqual({
      shape: 'none',
      hostCount: 0,
      allowFallbacks: undefined,
      dataCollection: 'deny',
    });
  });

  it('prefers only when both lists are somehow present (the resolver never builds that shape)', () => {
    expect(
      summarizeProviderRouting({
        only: ['z-ai'],
        ignore: ['minimax'],
        data_collection: 'deny',
      })
    ).toStrictEqual({
      shape: 'only',
      hostCount: 1,
      allowFallbacks: undefined,
      dataCollection: 'deny',
    });
  });
});
