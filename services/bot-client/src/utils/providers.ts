/**
 * Provider Utilities
 * Shared utilities for AI provider display and handling
 */

import { AIProvider } from '@tzurot/common-types/constants/ai';

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
