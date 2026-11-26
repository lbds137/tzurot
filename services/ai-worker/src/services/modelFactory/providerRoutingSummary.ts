/**
 * Log-summary of the OpenRouter `provider` routing object.
 *
 * `OpenRouterFetch`'s injection log carries this summary instead of the full
 * routing object: on a pinned call that object holds a ~30-entry `only`
 * array, repeated verbatim on every request log line. The summary keeps the
 * routing shape, the host count and the two scalar policy fields — never the
 * list itself.
 */

import { type OpenRouterProviderRouting } from './providerRouting.js';

/**
 * The `provider` field of the injection log: the routing shape, host count
 * and the two scalar policy fields — never the full host list.
 */
export interface ProviderRoutingLogSummary {
  shape: 'only' | 'ignore' | 'none';
  hostCount: number;
  allowFallbacks: boolean | undefined;
  dataCollection: 'deny' | undefined;
}

/**
 * Summarize the `provider` routing object for the injection log. `only` wins
 * when both lists are somehow present (the resolver never produces that
 * shape); an object with neither list, or an absent object, is `none`.
 */
export function summarizeProviderRouting(
  provider: OpenRouterProviderRouting | undefined
): ProviderRoutingLogSummary {
  if (provider === undefined) {
    return { shape: 'none', hostCount: 0, allowFallbacks: undefined, dataCollection: undefined };
  }
  const hostCount = provider.only?.length ?? provider.ignore?.length ?? 0;
  const shape: ProviderRoutingLogSummary['shape'] =
    provider.only !== undefined ? 'only' : provider.ignore !== undefined ? 'ignore' : 'none';
  return {
    shape,
    hostCount,
    allowFallbacks: provider.allow_fallbacks,
    dataCollection: provider.data_collection,
  };
}
