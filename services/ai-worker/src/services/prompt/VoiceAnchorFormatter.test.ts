/**
 * Tests for VoiceAnchorFormatter
 */

import { describe, it, expect } from 'vitest';
import {
  formatVoiceAnchor,
  voiceAnchorLeadIn,
  voiceAnchorDriftNote,
} from './VoiceAnchorFormatter.js';
import type { LoadedPersonality } from '@tzurot/common-types/types/schemas/personality';

function createMinimalPersonality(overrides: Partial<LoadedPersonality> = {}): LoadedPersonality {
  return {
    id: 'test-id',
    name: 'TestBot',
    slug: 'testbot',
    ownerId: 'owner-uuid-test',
    displayName: '',
    avatarUrl: '',
    characterInfo: '',
    personalityTraits: '',
    personalityTone: '',
    personalityAge: '',
    personalityAppearance: '',
    personalityLikes: '',
    personalityDislikes: '',
    conversationalGoals: '',
    conversationalExamples: '',
    systemPrompt: '',
    model: 'test-model',
    provider: 'openrouter',
    temperature: 0.7,
    maxTokens: 2000,
    contextWindowTokens: 8000,
    voiceEnabled: false,
    ...overrides,
  };
}

describe('VoiceAnchorFormatter', () => {
  describe('formatVoiceAnchor', () => {
    it('renders all three fields when present', () => {
      const personality = createMinimalPersonality({
        displayName: 'Test Bot',
        personalityTraits: 'Friendly and witty',
        personalityTone: 'Casual',
        conversationalExamples: 'User: Hi\nBot: Hello!',
      });

      const anchor = formatVoiceAnchor(personality);

      expect(anchor).toContain('<voice_anchor>');
      expect(anchor).toContain('</voice_anchor>');
      expect(anchor).toContain('<personality_traits>Friendly and witty</personality_traits>');
      expect(anchor).toContain('<personality_tone>Casual</personality_tone>');
      expect(anchor).toContain(
        '<conversational_examples>User: Hi\nBot: Hello!</conversational_examples>'
      );
      expect(anchor).toContain(voiceAnchorLeadIn('Test Bot'));
      expect(anchor).toContain(voiceAnchorDriftNote('Test Bot'));
    });

    it('omits an individually absent field without an empty tag', () => {
      const personality = createMinimalPersonality({
        displayName: 'Test Bot',
        personalityTraits: 'Friendly and witty',
        personalityTone: '',
        conversationalExamples: '',
      });

      const anchor = formatVoiceAnchor(personality);

      expect(anchor).toContain('<personality_traits>Friendly and witty</personality_traits>');
      expect(anchor).not.toContain('<personality_tone>');
      expect(anchor).not.toContain('<conversational_examples>');
    });

    it('returns empty string when all three fields are absent', () => {
      const personality = createMinimalPersonality({
        displayName: 'Test Bot',
        personalityTraits: '',
        personalityTone: '',
        conversationalExamples: '',
      });

      const anchor = formatVoiceAnchor(personality);

      expect(anchor).toBe('');
    });

    it('escapes a display name containing structural characters', () => {
      const personality = createMinimalPersonality({
        displayName: 'Test </character> Bot',
        personalityTraits: 'Friendly',
      });

      const anchor = formatVoiceAnchor(personality);

      expect(anchor).toContain('&lt;/character&gt;');
      expect(anchor).not.toContain('</character>');
    });

    it('falls back to name when displayName is absent', () => {
      const personality = createMinimalPersonality({
        name: 'FallbackName',
        displayName: '',
        personalityTraits: 'Friendly',
      });

      const anchor = formatVoiceAnchor(personality);

      expect(anchor).toContain(voiceAnchorLeadIn('FallbackName'));
    });
  });

  describe('voiceAnchorLeadIn', () => {
    it('names the personality and its precedence over earlier turns', () => {
      expect(voiceAnchorLeadIn('Aria')).toBe(
        'This is who Aria is right now. It outranks every earlier turn above it.'
      );
    });
  });

  describe('voiceAnchorDriftNote', () => {
    it('names the personality twice and warns against carrying history-only drift forward', () => {
      const note = voiceAnchorDriftNote('Aria');
      expect(note).toContain('Aria');
      expect(note.match(/Aria/g)).toHaveLength(2);
      expect(note).toContain('drift');
    });
  });
});
