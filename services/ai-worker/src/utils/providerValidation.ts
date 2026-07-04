/**
 * Provider validation utilities
 *
 * Defensive boundary helpers that coerce free-form provider strings (carried
 * by `LlmConfig.provider` at the DB layer and `LoadedPersonality.provider` in
 * the runtime data flow) into the typed `AIProvider` enum at consumption
 * sites — most notably the ModelFactory call in `ConversationalRAGService`.
 *
 * Why this exists: per `LlmConfigMapper.MappedLlmConfig.provider` docs,
 * "Consumers that need to switch on it should validate against the
 * AIProvider enum at the consumption boundary." `AuthStep` (via
 * `ProviderRouter`) is responsible for replacing fallthrough-routed values
 * with the resolved enum value before this point — but if a future provider
 * lands in the DB column ahead of the enum, an `AuthStep` gap leaves a stale
 * string in place, or `ConversationalRAGService` is ever called outside the
 * pipeline (test path, ad-hoc invocation), the validation guard prevents
 * `ModelFactory` from receiving a value that doesn't match any branch.
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('providerValidation');

/**
 * Coerce a string to `AIProvider`, falling back to OpenRouter (with a logged
 * warning) when the value doesn't match a known enum member.
 */
export function validateAIProvider(raw: string): AIProvider {
  if ((Object.values(AIProvider) as string[]).includes(raw)) {
    return raw as AIProvider;
  }
  logger.warn(
    { provider: raw, fallback: AIProvider.OpenRouter },
    'Unknown provider value at ModelFactory boundary — falling back to OpenRouter'
  );
  return AIProvider.OpenRouter;
}
