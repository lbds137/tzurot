/**
 * Tests for personality response formatters
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatPersonalityResponse, REDACTABLE_CARD_FIELDS } from './formatters.js';

// deriveAvatarUrl reads PUBLIC_GATEWAY_URL at call time — pin it so the
// expected avatarUrl below is deterministic regardless of .env.test.
beforeEach(() => {
  vi.stubEnv('PUBLIC_GATEWAY_URL', 'https://public.example');
});
afterEach(() => {
  vi.unstubAllEnvs();
});

function createMockPersonality(overrides: Record<string, unknown> = {}) {
  return {
    id: 'test-id',
    name: 'Test Bot',
    displayName: 'Test Display Name',
    slug: 'test-bot',
    characterInfo: 'Test character info',
    personalityTraits: 'Test traits',
    personalityTone: 'friendly',
    personalityAge: '25',
    personalityAppearance: 'tall',
    personalityLikes: 'coding',
    personalityDislikes: 'bugs',
    conversationalGoals: 'help users',
    conversationalExamples: 'example dialogue',
    errorMessage: 'custom error',
    birthMonth: 3,
    birthDay: 15,
    birthYear: 2000,
    isPublic: true,
    definitionPublic: false,
    voiceEnabled: false,
    imageEnabled: true,
    ownerId: 'owner-123',
    avatarData: Buffer.from('avatar'),
    voiceReferenceType: null,
    customFields: { key: 'value' },
    systemPromptId: 'prompt-123',
    voiceSettings: { voice: 'alloy' },
    imageSettings: { style: 'natural' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    ...overrides,
  };
}

describe('formatPersonalityResponse', () => {
  it('should format all fields correctly', () => {
    const personality = createMockPersonality();
    const result = formatPersonalityResponse(personality, { redact: false });

    expect(result).toEqual({
      id: 'test-id',
      name: 'Test Bot',
      displayName: 'Test Display Name',
      slug: 'test-bot',
      characterInfo: 'Test character info',
      personalityTraits: 'Test traits',
      personalityTone: 'friendly',
      personalityAge: '25',
      personalityAppearance: 'tall',
      personalityLikes: 'coding',
      personalityDislikes: 'bugs',
      conversationalGoals: 'help users',
      conversationalExamples: 'example dialogue',
      errorMessage: 'custom error',
      birthMonth: 3,
      birthDay: 15,
      birthYear: 2000,
      isPublic: true,
      definitionPublic: false,
      definitionRedacted: false,
      voiceEnabled: false,
      imageEnabled: true,
      ownerId: 'owner-123',
      hasAvatar: true,
      // Public URL, cache-busted with the fixture's own updatedAt epoch
      avatarUrl: `https://public.example/avatars/test-bot-${new Date('2026-02-01T00:00:00Z').getTime()}.png`,
      hasVoiceReference: false,
      customFields: { key: 'value' },
      systemPromptId: 'prompt-123',
      voiceSettings: { voice: 'alloy' },
      imageSettings: { style: 'natural' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  describe('redaction (definition privacy)', () => {
    // The card fields nulled for a non-owner of a definition-private character.
    // Deliberately an INDEPENDENT hand-list (not the exported tuple): if the
    // implementation's REDACTABLE_CARD_FIELDS silently dropped a field, a
    // tuple-iterating test would stop checking it. The equality pin below
    // catches drift in either direction.
    const CARD_FIELDS = [
      'characterInfo',
      'personalityTraits',
      'personalityTone',
      'personalityAge',
      'personalityAppearance',
      'personalityLikes',
      'personalityDislikes',
      'conversationalGoals',
      'conversationalExamples',
      'errorMessage',
      'customFields',
    ] as const;

    it('the implementation redacts exactly this security-reviewed field set', () => {
      expect([...REDACTABLE_CARD_FIELDS].sort()).toEqual([...CARD_FIELDS].sort());
    });

    it('nulls exactly the card fields and sets definitionRedacted when redact=true', () => {
      const result = formatPersonalityResponse(createMockPersonality(), { redact: true });
      for (const field of CARD_FIELDS) {
        expect(result[field], `${field} must be redacted`).toBeNull();
      }
      expect(result.definitionRedacted).toBe(true);
    });

    it('leaves non-card fields visible when redacted (name/avatar/flags/timestamps)', () => {
      const result = formatPersonalityResponse(createMockPersonality(), { redact: true });
      expect(result.name).toBe('Test Bot');
      expect(result.displayName).toBe('Test Display Name');
      expect(result.slug).toBe('test-bot');
      expect(result.hasAvatar).toBe(true);
      expect(result.isPublic).toBe(true);
      expect(result.definitionPublic).toBe(false);
      expect(result.voiceEnabled).toBe(false);
      expect(result.ownerId).toBe('owner-123');
      expect(result.createdAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('does not redact when redact=false (definitionRedacted false)', () => {
      const result = formatPersonalityResponse(createMockPersonality(), { redact: false });
      expect(result.characterInfo).toBe('Test character info');
      expect(result.definitionRedacted).toBe(false);
    });
  });

  it('should set hasAvatar to false when avatarData is null', () => {
    const personality = createMockPersonality({ avatarData: null });
    const result = formatPersonalityResponse(personality, { redact: false });
    expect(result.hasAvatar).toBe(false);
  });

  it('emits null avatarUrl when the character has no avatar (a derived URL would 404 → broken thumbnail)', () => {
    const personality = createMockPersonality({ avatarData: null });
    const result = formatPersonalityResponse(personality, { redact: false });
    expect(result.avatarUrl).toBeNull();
  });

  it('keeps avatarUrl visible when redacted — avatar presence is not a card field', () => {
    const result = formatPersonalityResponse(createMockPersonality(), { redact: true });
    expect(result.avatarUrl).toContain('https://public.example/avatars/test-bot-');
  });

  it('falls back to GATEWAY_URL when PUBLIC_GATEWAY_URL is unset (local dev)', () => {
    // stubEnv(undefined) DELETES the var — an empty string would NOT take
    // the ?? fallback in deriveAvatarUrl and would yield null instead.
    vi.stubEnv('PUBLIC_GATEWAY_URL', undefined);
    vi.stubEnv('GATEWAY_URL', 'http://localhost:3000');
    const result = formatPersonalityResponse(createMockPersonality(), { redact: false });
    expect(result.avatarUrl).toContain('http://localhost:3000/avatars/test-bot-');
  });

  it('should set hasAvatar to true when avatarData is present', () => {
    const personality = createMockPersonality({ avatarData: Buffer.from('data') });
    const result = formatPersonalityResponse(personality, { redact: false });
    expect(result.hasAvatar).toBe(true);
  });

  it('should set hasVoiceReference to false when voiceReferenceType is null', () => {
    const personality = createMockPersonality({ voiceReferenceType: null });
    const result = formatPersonalityResponse(personality, { redact: false });
    expect(result.hasVoiceReference).toBe(false);
  });

  it('should set hasVoiceReference to true when voiceReferenceType is present', () => {
    const personality = createMockPersonality({ voiceReferenceType: 'audio/wav' });
    const result = formatPersonalityResponse(personality, { redact: false });
    expect(result.hasVoiceReference).toBe(true);
  });

  it('should convert dates to ISO strings', () => {
    const personality = createMockPersonality({
      createdAt: new Date('2025-06-15T12:30:00Z'),
      updatedAt: new Date('2025-07-20T18:45:00Z'),
    });
    const result = formatPersonalityResponse(personality, { redact: false });
    expect(result.createdAt).toBe('2025-06-15T12:30:00.000Z');
    expect(result.updatedAt).toBe('2025-07-20T18:45:00.000Z');
  });

  it('should handle null optional fields', () => {
    const personality = createMockPersonality({
      displayName: null,
      personalityTone: null,
      personalityAge: null,
      personalityAppearance: null,
      personalityLikes: null,
      personalityDislikes: null,
      conversationalGoals: null,
      conversationalExamples: null,
      errorMessage: null,
      birthMonth: null,
      birthDay: null,
      birthYear: null,
      systemPromptId: null,
    });
    const result = formatPersonalityResponse(personality, { redact: false });

    expect(result.displayName).toBeNull();
    expect(result.personalityTone).toBeNull();
    expect(result.personalityAge).toBeNull();
    expect(result.personalityAppearance).toBeNull();
    expect(result.personalityLikes).toBeNull();
    expect(result.personalityDislikes).toBeNull();
    expect(result.conversationalGoals).toBeNull();
    expect(result.conversationalExamples).toBeNull();
    expect(result.errorMessage).toBeNull();
    expect(result.birthMonth).toBeNull();
    expect(result.birthDay).toBeNull();
    expect(result.birthYear).toBeNull();
    expect(result.systemPromptId).toBeNull();
  });
});
