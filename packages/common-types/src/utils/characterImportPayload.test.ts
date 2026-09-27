import { describe, it, expect } from 'vitest';
import { PersonalityCreateSchema } from '../schemas/api/personality.js';
import { buildImportPayload, getImportPayloadIssues } from './characterImportPayload.js';

const FULL_CARD: Record<string, unknown> = {
  name: 'Card Name',
  slug: 'ignored-because-normalizedSlug-wins',
  characterInfo: 'Background info',
  personalityTraits: 'Curious, kind',
  displayName: 'Display Name',
  isPublic: true,
  definitionPublic: true,
  personalityTone: 'friendly',
  personalityAge: '25',
  personalityAppearance: 'tall',
  personalityLikes: 'tea',
  personalityDislikes: 'noise',
  conversationalGoals: 'be helpful',
  conversationalExamples: 'Hi there!',
  customFields: { origin: 'test' },
  tags: ['fantasy', 'sci-fi'],
  avatarData: 'json-embedded-avatar',
  voiceReferenceData: 'json-embedded-voice',
  errorMessage: 'Something went wrong',
};

const REQUIRED_ONLY_CARD: Record<string, unknown> = {
  name: 'Minimal Card',
  characterInfo: 'Background info',
  personalityTraits: 'Curious',
};

describe('buildImportPayload', () => {
  it('maps a full card to the exact expected payload object', () => {
    const payload = buildImportPayload(FULL_CARD, 'card-slug', undefined, undefined);

    expect(payload).toEqual({
      name: 'Card Name',
      slug: 'card-slug',
      characterInfo: 'Background info',
      personalityTraits: 'Curious, kind',
      displayName: 'Display Name',
      isPublic: true,
      definitionPublic: true,
      personalityTone: 'friendly',
      personalityAge: '25',
      personalityAppearance: 'tall',
      personalityLikes: 'tea',
      personalityDislikes: 'noise',
      conversationalGoals: 'be helpful',
      conversationalExamples: 'Hi there!',
      customFields: { origin: 'test' },
      tags: ['fantasy', 'sci-fi'],
      avatarData: 'json-embedded-avatar',
      voiceReferenceData: 'json-embedded-voice',
      voiceEnabled: true,
      errorMessage: 'Something went wrong',
    });
  });

  it('maps absent optional fields to undefined', () => {
    const payload = buildImportPayload(REQUIRED_ONLY_CARD, 'minimal-card', undefined, undefined);

    expect(payload).toEqual({
      name: 'Minimal Card',
      slug: 'minimal-card',
      characterInfo: 'Background info',
      personalityTraits: 'Curious',
      displayName: undefined,
      isPublic: false,
      definitionPublic: false,
      personalityTone: undefined,
      personalityAge: undefined,
      personalityAppearance: undefined,
      personalityLikes: undefined,
      personalityDislikes: undefined,
      conversationalGoals: undefined,
      conversationalExamples: undefined,
      customFields: undefined,
      tags: undefined,
      avatarData: undefined,
      voiceReferenceData: undefined,
      voiceEnabled: undefined,
      errorMessage: undefined,
    });
  });

  it('defaults isPublic and definitionPublic to false when absent', () => {
    const payload = buildImportPayload(REQUIRED_ONLY_CARD, 'minimal-card', undefined, undefined);

    expect(payload.isPublic).toBe(false);
    expect(payload.definitionPublic).toBe(false);
  });

  it('defaults isPublic and definitionPublic to false when non-boolean', () => {
    const payload = buildImportPayload(
      { ...REQUIRED_ONLY_CARD, isPublic: 'yes', definitionPublic: 1 },
      'minimal-card',
      undefined,
      undefined
    );

    expect(payload.isPublic).toBe(false);
    expect(payload.definitionPublic).toBe(false);
  });

  it('attachment avatar data wins over JSON-embedded avatar data', () => {
    const payload = buildImportPayload(
      FULL_CARD,
      'card-slug',
      'attachment-avatar-base64',
      undefined
    );

    expect(payload.avatarData).toBe('attachment-avatar-base64');
  });

  it('attachment voice data wins over JSON-embedded voice data', () => {
    const payload = buildImportPayload(
      FULL_CARD,
      'card-slug',
      undefined,
      'attachment-voice-data-uri'
    );

    expect(payload.voiceReferenceData).toBe('attachment-voice-data-uri');
  });

  it('sets voiceEnabled true only when voice data is present', () => {
    const withVoice = buildImportPayload(REQUIRED_ONLY_CARD, 'slug', undefined, 'voice-data');
    const withoutVoice = buildImportPayload(REQUIRED_ONLY_CARD, 'slug', undefined, undefined);

    expect(withVoice.voiceEnabled).toBe(true);
    expect(withoutVoice.voiceEnabled).toBeUndefined();
  });

  it('strips unknown keys from the card off the built payload', () => {
    const payload = buildImportPayload(
      { ...REQUIRED_ONLY_CARD, birthMonth: 5 },
      'minimal-card',
      undefined,
      undefined
    );

    expect('birthMonth' in payload).toBe(false);
  });
});

describe('getImportPayloadIssues', () => {
  it('returns no issues for a valid payload', () => {
    const payload = buildImportPayload(FULL_CARD, 'card-slug', undefined, undefined);

    expect(getImportPayloadIssues(payload)).toEqual([]);
  });

  it('reports an issue for an invalid slug', () => {
    const payload = buildImportPayload(FULL_CARD, 'Not A Valid Slug!', undefined, undefined);

    const issues = getImportPayloadIssues(payload);
    expect(issues).toContainEqual(expect.objectContaining({ field: 'slug' }));
  });

  it('reports an issue for a missing characterInfo', () => {
    const { characterInfo: _dropped, ...withoutCharacterInfo } = REQUIRED_ONLY_CARD;
    const payload = buildImportPayload(withoutCharacterInfo, 'minimal-card', undefined, undefined);

    const issues = getImportPayloadIssues(payload);
    expect(issues).toContainEqual(expect.objectContaining({ field: 'characterInfo' }));
  });

  it('the schema itself strips an unknown key on parse (unknown keys never round-trip)', () => {
    const payload = buildImportPayload(REQUIRED_ONLY_CARD, 'minimal-card', undefined, undefined);
    const parsed = PersonalityCreateSchema.parse({ ...payload, birthMonth: 5 });

    expect('birthMonth' in parsed).toBe(false);
  });
});
