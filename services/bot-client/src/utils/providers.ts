/**
 * Provider Utilities
 * Shared utilities for AI provider display and handling
 */

import { AIProvider } from '@tzurot/common-types';

/**
 * Get human-readable display name for a provider
 */
export function getProviderDisplayName(provider: AIProvider): string {
  switch (provider) {
    case AIProvider.OpenRouter:
      return 'OpenRouter';
    case AIProvider.ElevenLabs:
      return 'ElevenLabs';
    default: {
      // Type guard for exhaustive check - add new providers above
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}
