/**
 * Tests for providers utilities
 */

import { describe, it, expect } from 'vitest';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { getProviderDisplayName } from './providers.js';

describe('providers', () => {
  describe('getProviderDisplayName', () => {
    it('should return "OpenRouter" for OpenRouter provider', () => {
      expect(getProviderDisplayName(AIProvider.OpenRouter)).toBe('OpenRouter');
    });

    it('should return "ElevenLabs" for ElevenLabs provider', () => {
      expect(getProviderDisplayName(AIProvider.ElevenLabs)).toBe('ElevenLabs');
    });

    it('should return "Z.AI Coding Plan" for ZaiCoding provider', () => {
      expect(getProviderDisplayName(AIProvider.ZaiCoding)).toBe('Z.AI Coding Plan');
    });
  });
});
