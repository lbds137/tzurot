import { describe, expect, it } from 'vitest';

import { summarizeExtraParamsForLog, summarizeProviderRouting } from './providerRoutingSummary.js';

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

describe('summarizeExtraParamsForLog', () => {
  it('passes tuning params through and replaces provider with its summary (no host list)', () => {
    const logged = summarizeExtraParamsForLog({
      route: 'fallback',
      verbosity: 'low',
      provider: { only: ['host-a', 'host-b'], allow_fallbacks: false, data_collection: 'deny' },
    });
    expect(logged).toStrictEqual({
      route: 'fallback',
      verbosity: 'low',
      provider: {
        shape: 'only',
        allowedHostCount: 2,
        ignoredHostCount: 0,
        allowFallbacks: false,
        dataCollection: 'deny',
      },
    });
    expect(JSON.stringify(logged)).not.toContain('host-a');
  });

  it('reports shape none (provider key still present) when no routing object is carried', () => {
    expect(summarizeExtraParamsForLog({ route: 'fallback' })).toStrictEqual({
      route: 'fallback',
      provider: {
        shape: 'none',
        allowedHostCount: 0,
        ignoredHostCount: 0,
        allowFallbacks: undefined,
        dataCollection: undefined,
      },
    });
  });
});
