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
  });
});
