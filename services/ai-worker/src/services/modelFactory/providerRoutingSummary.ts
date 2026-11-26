/**
 * Log-summary of the OpenRouter `provider` routing object.
 *
 * `OpenRouterFetch`'s injection log carries this summary instead of the full
 * routing object: on a pinned call that object holds a ~30-entry `only`
 * array, repeated verbatim on every request log line. The summary keeps the
 * routing shape, the allowed and ignored host counts and the two scalar policy
 * fields — never the list itself.
 */

import { type OpenRouterProviderRouting } from './providerRouting.js';

/**
 * The `provider` field of the injection log: the routing shape, the two host
 * counts and the two scalar policy fields — never the full host list.
 * `allowedHostCount` is the length of `only` (0 when absent); `ignoredHostCount`
 * is the length of `ignore` (0 when absent). Each is reported on its own so a
 * log line never reads an excluded-host count as an allowed-host count.
 */
export interface ProviderRoutingLogSummary {
  shape: 'only' | 'ignore' | 'none';
  allowedHostCount: number;
  ignoredHostCount: number;
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
    return {
      shape: 'none',
      allowedHostCount: 0,
      ignoredHostCount: 0,
      allowFallbacks: undefined,
      dataCollection: undefined,
    };
  }
  const shape: ProviderRoutingLogSummary['shape'] =
    provider.only !== undefined ? 'only' : provider.ignore !== undefined ? 'ignore' : 'none';
  return {
    shape,
    allowedHostCount: provider.only?.length ?? 0,
    ignoredHostCount: provider.ignore?.length ?? 0,
    allowFallbacks: provider.allow_fallbacks,
    dataCollection: provider.data_collection,
  };
}
