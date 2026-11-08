/**
 * Provider display names
 * Human-readable AI provider names, and the user-facing messages built from them
 */

import { AIProvider } from '../constants/ai.js';

/**
 * Get human-readable display name for a provider
 */
export function getProviderDisplayName(provider: AIProvider): string {
  switch (provider) {
    case AIProvider.OpenRouter:
      return 'OpenRouter';
    case AIProvider.ElevenLabs:
      return 'ElevenLabs';
    case AIProvider.ZaiCoding:
      return 'Z.AI Coding Plan';
    case AIProvider.Mistral:
      return 'Mistral (Voxtral TTS/STT)';
    default: {
      // Type guard for exhaustive check - add new providers above
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}

/** Sent when a user's stored BYOK API key exists but cannot be decrypted; the fix is re-entering it. */
export function undecryptableApiKeyMessage(provider: AIProvider): string {
  return `Your saved ${getProviderDisplayName(provider)} key can't be read anymore. Set it again with /settings apikey set.`;
}
