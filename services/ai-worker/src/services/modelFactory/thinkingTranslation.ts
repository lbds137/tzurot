/**
 * Provider-aware translation of the canonical `thinking` level onto each
 * provider's own extended-reasoning protocol.
 *
 * This module is the ONLY place the translation table lives. The canonical
 * level is provider-neutral by design (see `THINKING_LEVELS` in
 * llmAdvancedParams.ts); every provider that understands extended reasoning
 * spells it differently on the wire, and sending one provider's spelling to
 * another is silently ignored rather than rejected — which is exactly the
 * failure this module exists to prevent.
 *
 * The per-provider wire shapes are pinned by `thinkingTranslation.test.ts`.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import type { ThinkingLevel } from '@tzurot/common-types/schemas/llmAdvancedParams';

/**
 * Translate the canonical thinking level into OpenRouter's `reasoning` object.
 *
 * Our `off` maps to their `none`; every other level is sent under its own name.
 *
 * `exclude` is deliberately never sent: both providers default to returning the
 * trace, which is the only behavior `/inspect` can work with.
 */
function buildOpenRouterThinking(thinking: ThinkingLevel): Record<string, unknown> {
  return { reasoning: { effort: thinking === 'off' ? 'none' : thinking } };
}

/**
 * Translate the canonical thinking level into z.ai's own protocol.
 *
 * z.ai splits the knob in two: a `thinking.type` enable/disable switch and a
 * separate `reasoning_effort` level. It does NOT read OpenRouter's `reasoning`
 * object — an unknown param is accepted and ignored, so sending the OpenRouter
 * shape here disables nothing and requests nothing.
 */
function buildZaiThinking(thinking: ThinkingLevel): Record<string, unknown> {
  if (thinking === 'off') {
    return { thinking: { type: 'disabled' } };
  }
  return { thinking: { type: 'enabled' }, reasoning_effort: thinking };
}

/**
 * Build the modelKwargs FRAGMENT carrying the thinking level for `provider`.
 *
 * Returns `undefined` to mean "send nothing" — absent is distinct from `off`
 * (absent takes the provider default, `off` explicitly disables), so an absent
 * level must stay absent rather than becoming an explicit disable.
 *
 * Providers that are not LLM providers get `undefined`: `createChatModel`
 * throws for them immediately after building kwargs, so the value is never
 * sent anywhere.
 */
export function buildThinkingKwargs(
  thinking: ThinkingLevel | undefined,
  provider: AIProvider
): Record<string, unknown> | undefined {
  if (thinking === undefined) {
    return undefined;
  }

  switch (provider) {
    case AIProvider.OpenRouter:
      return buildOpenRouterThinking(thinking);
    case AIProvider.ZaiCoding:
      return buildZaiThinking(thinking);
    case AIProvider.ElevenLabs:
    case AIProvider.Mistral:
      return undefined;
  }
  // Compile-time exhaustiveness: `provider` narrows to `never` once every
  // AIProvider member has an arm, so a newly-added provider fails to compile
  // here until its translation (or explicit no-op) is declared above.
  return provider satisfies never;
}
