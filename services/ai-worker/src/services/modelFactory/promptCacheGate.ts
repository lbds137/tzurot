/**
 * The prompt-caching gate, shared by the factory, the cache key and the
 * generated-response log.
 */

import { AIProvider, isAnthropicFamilyModelId } from '@tzurot/common-types/constants/ai';

/**
 * Whether ModelFactory bakes the conversation's prompt-caching breakpoints and
 * session id into a model instance: the OpenRouter provider, the
 * `promptCaching` opt-in, and an anthropic-family id. The one statement of that
 * gate; the factory, the cache key and the generated-response log all call it.
 */
export function promptCacheGateFires(opts: {
  provider: AIProvider;
  promptCaching: boolean | undefined;
  modelName: string;
}): boolean {
  return (
    opts.provider === AIProvider.OpenRouter &&
    opts.promptCaching === true &&
    isAnthropicFamilyModelId(opts.modelName)
  );
}
