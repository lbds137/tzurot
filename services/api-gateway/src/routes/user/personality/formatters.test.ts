/**
 * Tests for personality response formatters
 */

import { describe, it, expect } from 'vitest';
import { formatPersonalityResponse } from './formatters.js';

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
    voiceEnabled: false,
    imageEnabled: true,
    ownerId: 'owner-123',
    avatarData: Buffer.from('avatar'),
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
    const result = formatPersonalityResponse(personality);

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
      voiceEnabled: false,
      imageEnabled: true,
      ownerId: 'owner-123',
      hasAvatar: true,
      customFields: { key: 'value' },
      systemPromptId: 'prompt-123',
      voiceSettings: { voice: 'alloy' },
      imageSettings: { style: 'natural' },
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-02-01T00:00:00.000Z',
    });
  });

  it('should set hasAvatar to false when avatarData is null', () => {
    const personality = createMockPersonality({ avatarData: null });
    const result = formatPersonalityResponse(personality);
    expect(result.hasAvatar).toBe(false);
  });

  it('should set hasAvatar to true when avatarData is present', () => {
    const personality = createMockPersonality({ avatarData: Buffer.from('data') });
    const result = formatPersonalityResponse(personality);
    expect(result.hasAvatar).toBe(true);
  });

  it('should convert dates to ISO strings', () => {
    const personality = createMockPersonality({
      createdAt: new Date('2025-06-15T12:30:00Z'),
      updatedAt: new Date('2025-07-20T18:45:00Z'),
    });
    const result = formatPersonalityResponse(personality);
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
    const result = formatPersonalityResponse(personality);

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
