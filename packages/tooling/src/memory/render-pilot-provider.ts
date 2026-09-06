/**
 * Provider routing for the render pilot's chat-completion calls: OpenRouter
 * (metered) for the judge family, and z.ai's coding-plan endpoint (flat-rate)
 * for the GLM answer/summary/voice calls that mirror the production
 * extraction path, which runs on that plan rather than through OpenRouter.
 *
 * The z.ai coding-plan wire shapes below are an external-system contract
 * established by a live probe against the plan, not documentation or memory:
 * bare (unprefixed) model ids, a two-header auth (no `HTTP-Referer`/`X-Title`),
 * a `thinking` object instead of OpenRouter's `reasoning`, and the reasoning
 * trace returned under `reasoning_content` rather than `reasoning`.
 */

import { AI_ENDPOINTS, toZaiWireModelId } from '@tzurot/common-types/constants/ai';

export type RenderPilotProvider = 'openrouter' | 'zai-coding';
export type ThinkingSetting = 'disabled' | 'high';

const OPENROUTER_CHAT_URL = `${AI_ENDPOINTS.OPENROUTER_BASE_URL}/chat/completions`;
const ZAI_CODING_CHAT_URL = `${AI_ENDPOINTS.ZAI_CODING_BASE_URL}/chat/completions`;

/** The environment variable each provider's API key is read from. */
export function providerEnvVar(provider: RenderPilotProvider): string {
  return provider === 'openrouter' ? 'OPENROUTER_API_KEY' : 'ZAI_CODING_API_KEY';
}

/** The chat-completions endpoint for `provider`. */
export function providerUrl(provider: RenderPilotProvider): string {
  return provider === 'openrouter' ? OPENROUTER_CHAT_URL : ZAI_CODING_CHAT_URL;
}

/**
 * Request headers for `provider`. OpenRouter's `HTTP-Referer`/`X-Title` are
 * OpenRouter-specific attribution headers; the live probe against the coding
 * plan never sent them, so they are omitted for `zai-coding` rather than
 * risking an unrecognized-header rejection.
 */
export function providerHeaders(
  provider: RenderPilotProvider,
  apiKey: string
): Record<string, string> {
  if (provider === 'openrouter') {
    return {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/lbds137/tzurot',
      'X-Title': 'tzurot render pilot',
    };
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
}

/**
 * The model id to send on the wire for `provider`. OpenRouter takes the
 * routable id unchanged; the coding plan requires the bare id — this reuses
 * `toZaiWireModelId`, which strips an optional `z-ai/` prefix and preserves
 * the rest of the id's case.
 */
export function providerModelId(provider: RenderPilotProvider, model: string): string {
  return provider === 'openrouter' ? model : toZaiWireModelId(model);
}

/**
 * The `thinking`-related body fragment for `provider`/`thinking`. OpenRouter
 * calls in this pilot never request extended reasoning, so it always gets an
 * empty fragment. An absent `thinking` setting also means "send nothing" —
 * distinct from `'disabled'`, which explicitly turns reasoning off on the
 * wire rather than leaving the plan's own default in place.
 */
export function thinkingBody(
  provider: RenderPilotProvider,
  thinking: ThinkingSetting | undefined
): Record<string, unknown> {
  if (provider === 'openrouter' || thinking === undefined) {
    return {};
  }
  if (thinking === 'disabled') {
    return { thinking: { type: 'disabled' } };
  }
  return { thinking: { type: 'enabled' }, reasoning_effort: 'high' };
}
