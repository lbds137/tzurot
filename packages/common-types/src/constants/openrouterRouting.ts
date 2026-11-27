/**
 * OpenRouter provider-routing constants.
 *
 * Every ai-worker OpenRouter chat call sends a `provider` routing object with
 * `data_collection: 'deny'`. A pinned model id is restricted to its measured
 * `only` allowlist with fallbacks off; every other id excludes the ignore-list
 * hosts (the MiniMax family plus forwarders) and may be served by any other
 * host. Retention and training enforcement is OpenRouter's server-side policy
 * and is not verifiable from this code. The wire shapes built from these
 * tables live in `utils/openrouterRoutingResolver.ts`; this
 * module holds only the data. Both live in common-types so ai-worker and
 * tooling scripts that call OpenRouter directly apply the same routing
 * (`packages/tooling` cannot import from a service).
 */

/**
 * OpenRouter provider-routing tables applied to every OpenRouter chat call.
 */
export const OPENROUTER_ROUTING = {
  /**
   * Host slugs never allowed to serve ANY model: ignored on every unpinned
   * request via `provider.ignore`. Covers the MiniMax host itself and the
   * forwarders that hand traffic to it.
   */
  FORWARDER_IGNORE: ['minimax', 'atlas-cloud', 'novita', 'streamlake'],
  /**
   * Exact OpenRouter model ids with a measured host allowlist: such a model
   * is pinned via `provider.only` + `allow_fallbacks: false`, bypassing the
   * ignore table. The allowlist was chosen by measured refusal behaviour per
   * host (TASK-1261). Unlisted model ids — including suffixed variants of a
   * pinned id — never match and take the ignore table.
   */
  PINNED_MODELS: {
    'z-ai/glm-5.3-flash': [
      'z-ai',
      'baidu',
      'baseten',
      'cohere',
      'coreweave',
      'crusoe',
      'deepinfra',
      'digitalocean',
      'fireworks',
      'friendli',
      'inceptron',
      'inference-net',
      'kt',
      'mistral',
      'modal',
      'morph',
      'near-ai',
      'nebius',
      'open-inference',
      'parasail',
      'pareto-inference',
      'particle-ai',
      'reka',
      'relace',
      'river',
      'sail-research',
      'siliconflow',
      'together',
      'venice',
      'wafer',
    ],
  },
} as const;

/** Exact model id whose traffic is pinned to its measured host allowlist. */
export type PinnedOpenRouterModel = keyof typeof OPENROUTER_ROUTING.PINNED_MODELS;
