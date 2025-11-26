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
    case AIProvider.OpenAI:
      return 'OpenAI';
    default:
      return provider;
  }
}
