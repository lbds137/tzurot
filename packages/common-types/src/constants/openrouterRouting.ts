/**
 * OpenRouter provider-routing constants.
 *
 * Every OpenRouter chat call sends a `provider` routing object so the system
 * key's traffic reaches only hosts this project has vetted: prompts go to
 * hosts that do not retain or train on them, the MiniMax host family never
 * serves a request, and one measured allowlist governs a specific pinned
 * model. The wire shapes built from these tables live in ai-worker's
 * `providerRouting.ts` resolver; this module holds only the data.
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
