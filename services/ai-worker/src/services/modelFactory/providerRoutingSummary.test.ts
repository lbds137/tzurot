import { describe, expect, it } from 'vitest';

import { summarizeProviderRouting } from './providerRoutingSummary.js';

describe('summarizeProviderRouting', () => {
  it('summarizes the only shape (pin): allowed host count + scalars, no host list', () => {
    expect(
      summarizeProviderRouting({
        only: ['z-ai', 'fireworks', 'together'],
        allow_fallbacks: false,
        data_collection: 'deny',
      })
    ).toStrictEqual({
      shape: 'only',
      allowedHostCount: 3,
      ignoredHostCount: 0,
      allowFallbacks: false,
      dataCollection: 'deny',
    });
  });

  it('summarizes the ignore shape: ignored host count from ignore, allowFallbacks undefined', () => {
    expect(
      summarizeProviderRouting({ ignore: ['minimax', 'atlas-cloud'], data_collection: 'deny' })
    ).toStrictEqual({
      shape: 'ignore',
      allowedHostCount: 0,
      ignoredHostCount: 2,
      allowFallbacks: undefined,
      dataCollection: 'deny',
    });
  });

  it('summarizes an absent routing object as shape none', () => {
    expect(summarizeProviderRouting(undefined)).toStrictEqual({
      shape: 'none',
      allowedHostCount: 0,
      ignoredHostCount: 0,
      allowFallbacks: undefined,
      dataCollection: undefined,
    });
  });

  it('summarizes a routing object with neither list as shape none (both host counts 0)', () => {
    expect(summarizeProviderRouting({ data_collection: 'deny' })).toStrictEqual({
      shape: 'none',
      allowedHostCount: 0,
      ignoredHostCount: 0,
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
      allowedHostCount: 1,
      ignoredHostCount: 1,
      allowFallbacks: undefined,
      dataCollection: 'deny',
    });
  });
});
