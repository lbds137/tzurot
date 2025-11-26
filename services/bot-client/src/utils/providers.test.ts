/**
 * Tests for providers utilities
 */

import { describe, it, expect } from 'vitest';
import { AIProvider } from '@tzurot/common-types';
import { getProviderDisplayName } from './providers.js';

describe('providers', () => {
  describe('getProviderDisplayName', () => {
    it('should return "OpenRouter" for OpenRouter provider', () => {
      expect(getProviderDisplayName(AIProvider.OpenRouter)).toBe('OpenRouter');
    });

    it('should return "OpenAI" for OpenAI provider', () => {
      expect(getProviderDisplayName(AIProvider.OpenAI)).toBe('OpenAI');
    });

    it('should return provider value for unknown providers', () => {
      // Cast to AIProvider to test fallback behavior
      expect(getProviderDisplayName('unknown-provider' as AIProvider)).toBe('unknown-provider');
    });
  });
});
