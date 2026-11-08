/**
 * Tests for providerDisplayName utilities
 */

import { describe, it, expect } from 'vitest';
import { AIProvider } from '../constants/ai.js';
import { getProviderDisplayName, undecryptableApiKeyMessage } from './providerDisplayName.js';

describe('providerDisplayName', () => {
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

    it('should return "Mistral (Voxtral TTS/STT)" for Mistral provider', () => {
      expect(getProviderDisplayName(AIProvider.Mistral)).toBe('Mistral (Voxtral TTS/STT)');
    });
  });

  describe('undecryptableApiKeyMessage', () => {
    it('should return the re-enter message with the provider display name', () => {
      expect(undecryptableApiKeyMessage(AIProvider.OpenRouter)).toBe(
        "Your saved OpenRouter key can't be read anymore. Set it again with /settings apikey set."
      );
    });

    it('should return the ElevenLabs re-enter message literal', () => {
      expect(undecryptableApiKeyMessage(AIProvider.ElevenLabs)).toBe(
        "Your saved ElevenLabs key can't be read anymore. Set it again with /settings apikey set."
      );
    });
  });
});
