/**
 * OpenRouter provider-routing resolver.
 *
 * Pure function from the model id to the `provider` routing object every
 * OpenRouter chat call sends. Two shapes:
 * - a PINNED model id (exact match) is sent its measured host allowlist as
 *   `only` + `allow_fallbacks: false` (whether `only` alone already keeps
 *   OpenRouter from using unlisted hosts is not probed);
 * - every other id takes the shared ignore table (`FORWARDER_IGNORE`), which
 *   keeps the MiniMax host family from serving anything.
 *
 * Both shapes carry `data_collection: 'deny'`. Whether a host retains or trains
 * on prompts is OpenRouter's server-side policy to enforce, and is not
 * verifiable from this code. The tables live in
 * `@tzurot/common-types/constants/openrouterRouting`; this module builds the
 * per-call wire objects.
 */

import {
  OPENROUTER_ROUTING,
  type PinnedOpenRouterModel,
} from '@tzurot/common-types/constants/openrouterRouting';

/**
 * The `provider` routing object on the OpenRouter request body. Field names
 * are the wire names exactly, not camelCase — this object is copied onto the
 * request body verbatim.
 */
export interface OpenRouterProviderRouting {
  /** Host slugs exclusively allowed to serve the request (pin shape). */
  only?: string[];
  /** Host slugs never allowed to serve the request (ignore shape). */
  ignore?: string[];
  /** Sent as false with `only` to forbid fallback to unlisted hosts; whether `only` alone already enforces that is not probed. */
  allow_fallbacks?: boolean;
  /** Host eligibility for prompt retention/training — always deny. */
  data_collection: 'deny';
}

/**
 * Resolve the routing object for one OpenRouter model id.
 *
 * Exact-id match only: a pinned id returns the `only` shape; everything else
 * — other GLM ids, suffixed variants such as `z-ai/glm-5.3-flash:free`,
 * `openrouter/free`, `openrouter/auto`, `minimax/*` — returns the ignore
 * shape. Arrays are FRESH per call (never the frozen constant arrays), so a
 * downstream mutation cannot corrupt the routing table.
 */
export function resolveOpenRouterProviderRouting(modelId: string): OpenRouterProviderRouting {
  // hasOwn, not a bare index: an id like "constructor" must not resolve to an
  // Object.prototype member and take the pinned branch.
  if (Object.hasOwn(OPENROUTER_ROUTING.PINNED_MODELS, modelId)) {
    const pinned: readonly string[] =
      OPENROUTER_ROUTING.PINNED_MODELS[modelId as PinnedOpenRouterModel];
    return {
      only: [...pinned],
      allow_fallbacks: false,
      data_collection: 'deny',
    };
  }
  return {
    ignore: [...OPENROUTER_ROUTING.FORWARDER_IGNORE],
    data_collection: 'deny',
  };
}
