/**
 * Tests for Character View Page Building
 */

import { describe, it, expect } from 'vitest';
import { buildCharacterViewPage, buildRedactedViewPage } from './viewPages.js';
import type { CharacterData } from './characterTypes.js';

/**
 * Create a minimal valid CharacterData for testing
 */
function createTestCharacter(overrides: Partial<CharacterData> = {}): CharacterData {
  return {
    id: 'test-id',
    name: 'Test Character',
    displayName: null,
    slug: 'test-character',
    characterInfo: 'Test background info',
    personalityTraits: 'Test traits',
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
    isPublic: false,
    definitionPublic: false,
    definitionRedacted: false,
    tags: [],
    voiceEnabled: false,
    hasVoiceReference: false,
    imageEnabled: false,
    ownerId: 'owner-123',
    avatarData: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('buildCharacterViewPage', () => {
  describe('Page 0: Overview & Identity', () => {
    it('should show character name and slug', () => {
      const character = createTestCharacter({ name: 'Luna', slug: 'luna-test' });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      expect(json.title).toContain('Luna');
      expect(json.title).toContain('Identity');

      const identityField = json.fields?.find(f => f.name.includes('Identity'));
      expect(identityField?.value).toContain('Luna');
      expect(identityField?.value).toContain('luna-test');
    });

    it('should show display name when set', () => {
      const character = createTestCharacter({
        name: 'Luna',
        displayName: 'Luna the Wise',
      });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      expect(json.title).toContain('Luna the Wise');
    });

    it('shows a Tags field on the overview when the character has tags', () => {
      const character = createTestCharacter({ tags: ['fantasy', 'sci-fi'] });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      const tagsField = json.fields?.find(f => f.name.includes('Tags'));
      expect(tagsField?.value).toBe('fantasy, sci-fi');
    });

    it('omits the Tags field entirely when the character has none', () => {
      const character = createTestCharacter({ tags: [] });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      expect(json.fields?.some(f => f.name.includes('Tags'))).toBe(false);
    });

    it('should show settings (visibility, voice, images)', () => {
      const character = createTestCharacter({
        isPublic: true,
        voiceEnabled: true,
        hasVoiceReference: true,
        imageEnabled: false,
      });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      const settingsField = json.fields?.find(f => f.name.includes('Settings'));
      expect(settingsField?.value).toContain('Public');
      expect(settingsField?.value).toContain('Enabled'); // Voice
    });

    it('should show traits, tone, and age', () => {
      const character = createTestCharacter({
        personalityTraits: 'Curious and playful',
        personalityTone: 'friendly',
        personalityAge: '25',
      });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      const traitsField = json.fields?.find(f => f.name.includes('Traits'));
      expect(traitsField?.value).toContain('Curious and playful');

      const toneField = json.fields?.find(f => f.name.includes('Tone'));
      expect(toneField?.value).toBe('friendly');

      const ageField = json.fields?.find(f => f.name.includes('Age'));
      expect(ageField?.value).toBe('25');
    });

    it('should track truncated traits field', () => {
      const character = createTestCharacter({
        personalityTraits: 'x'.repeat(1000), // Will be truncated
      });
      const { truncatedFields } = buildCharacterViewPage(character, 0);

      expect(truncatedFields).toContain('personalityTraits');
    });
  });

  describe('Redacted page (embed renderer)', () => {
    it('still shows Tags — they survive redaction gateway-side', () => {
      const character = createTestCharacter({
        definitionRedacted: true,
        tags: ['fantasy', 'sci-fi'],
      });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      expect(json.description).toContain('definition is private');
      const tagsField = json.fields?.find(f => f.name.includes('Tags'));
      expect(tagsField?.value).toBe('fantasy, sci-fi');
    });

    it('omits the Tags field on the redacted page when the character has none', () => {
      const character = createTestCharacter({ definitionRedacted: true, tags: [] });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      expect(json.fields?.some(f => f.name.includes('Tags'))).toBe(false);
    });
  });

  describe('Page 1: Biography & Appearance', () => {
    it('should show characterInfo and appearance', () => {
      const character = createTestCharacter({
        characterInfo: 'A mystical creature from ancient times',
        personalityAppearance: 'Tall with silver hair',
      });
      const { embed } = buildCharacterViewPage(character, 1);
      const json = embed.toJSON();

      expect(json.title).toContain('Biography');

      const infoField = json.fields?.find(f => f.name.includes('Character Info'));
      expect(infoField?.value).toContain('mystical creature');

      const appearanceField = json.fields?.find(f => f.name.includes('Appearance'));
      expect(appearanceField?.value).toContain('silver hair');
    });

    it('should show "_Not set_" for missing appearance', () => {
      const character = createTestCharacter({
        characterInfo: 'Some info',
        personalityAppearance: null,
      });
      const { embed } = buildCharacterViewPage(character, 1);
      const json = embed.toJSON();

      const appearanceField = json.fields?.find(f => f.name.includes('Appearance'));
      expect(appearanceField?.value).toBe('_Not set_');
    });

    it('should track truncated fields', () => {
      const character = createTestCharacter({
        characterInfo: 'x'.repeat(2000),
        personalityAppearance: 'y'.repeat(2000),
      });
      const { truncatedFields } = buildCharacterViewPage(character, 1);

      expect(truncatedFields).toContain('characterInfo');
      expect(truncatedFields).toContain('personalityAppearance');
    });
  });

  describe('Page 2: Preferences', () => {
    it('should show likes and dislikes', () => {
      const character = createTestCharacter({
        personalityLikes: 'Music, art, stargazing',
        personalityDislikes: 'Loud noises, crowds',
      });
      const { embed } = buildCharacterViewPage(character, 2);
      const json = embed.toJSON();

      expect(json.title).toContain('Preferences');

      const likesField = json.fields?.find(f => f.name.includes('Likes'));
      expect(likesField?.value).toContain('Music');

      const dislikesField = json.fields?.find(f => f.name.includes('Dislikes'));
      expect(dislikesField?.value).toContain('Loud noises');
    });

    it('should show "_Not set_" for missing preferences', () => {
      const character = createTestCharacter({
        personalityLikes: null,
        personalityDislikes: null,
      });
      const { embed } = buildCharacterViewPage(character, 2);
      const json = embed.toJSON();

      const likesField = json.fields?.find(f => f.name.includes('Likes'));
      expect(likesField?.value).toBe('_Not set_');
    });

    it('should track truncated fields', () => {
      const character = createTestCharacter({
        personalityLikes: 'x'.repeat(2000),
        personalityDislikes: 'y'.repeat(2000),
      });
      const { truncatedFields } = buildCharacterViewPage(character, 2);

      expect(truncatedFields).toContain('personalityLikes');
      expect(truncatedFields).toContain('personalityDislikes');
    });
  });

  describe('Page 3: Conversation & Errors', () => {
    it('should show goals, examples, and error message', () => {
      const character = createTestCharacter({
        conversationalGoals: 'Be helpful and engaging',
        conversationalExamples: 'User: Hi\nBot: Hello there!',
        errorMessage: 'Oops, something went wrong',
      });
      const { embed } = buildCharacterViewPage(character, 3);
      const json = embed.toJSON();

      expect(json.title).toContain('Conversation');

      const goalsField = json.fields?.find(f => f.name.includes('Goals'));
      expect(goalsField?.value).toContain('helpful');

      const examplesField = json.fields?.find(f => f.name.includes('Example'));
      expect(examplesField?.value).toContain('Hello there');

      const errorField = json.fields?.find(f => f.name.includes('Error'));
      expect(errorField?.value).toContain('went wrong');
    });

    it('should track truncated fields', () => {
      const character = createTestCharacter({
        conversationalGoals: 'x'.repeat(2000),
        conversationalExamples: 'y'.repeat(2000),
        errorMessage: 'z'.repeat(2000),
      });
      const { truncatedFields } = buildCharacterViewPage(character, 3);

      expect(truncatedFields).toContain('conversationalGoals');
      expect(truncatedFields).toContain('conversationalExamples');
      expect(truncatedFields).toContain('errorMessage');
    });
  });

  describe('Page boundary handling', () => {
    it('should clamp negative page numbers to 0', () => {
      const character = createTestCharacter();
      const { embed } = buildCharacterViewPage(character, -1);
      const json = embed.toJSON();

      expect(json.title).toContain('Identity');
    });

    it('should clamp page numbers exceeding max to last page', () => {
      const character = createTestCharacter();
      const { embed } = buildCharacterViewPage(character, 100);
      const json = embed.toJSON();

      expect(json.title).toContain('Conversation');
    });
  });

  describe('payload-cap clamps', () => {
    it('overview identity field stays inside the 1024-char cap for maximal escaped names', () => {
      // Two schema-legal 255-char names, doubled by markdown escaping, exceed
      // the field cap — discord.js would THROW at addFields without the clamp.
      // Backticks escape 2:1 (measured: 255 → 510), so two maximal names
      // plus the field chrome exceed 1024 — the pre-clamp build THREW here.
      const character = createTestCharacter({
        name: '`'.repeat(255),
        displayName: '`'.repeat(255),
      });
      const { embed } = buildCharacterViewPage(character, 0);
      const identity = embed.toJSON().fields?.find(f => f.name.includes('Identity'));
      expect(identity?.value.length).toBeLessThanOrEqual(1024);
    });

    it('redacted view builds (rather than throws) for maximal escaped names', () => {
      // The same concatenation exists on the redacted detail page reached via
      // browse — the sibling instance a review caught unclamped.
      const character = createTestCharacter({
        name: '`'.repeat(255),
        displayName: '`'.repeat(255),
      });
      const { embed } = buildRedactedViewPage(character);
      const identity = embed.toJSON().fields?.find(f => f.name.includes('Identity'));
      expect(identity?.value.length).toBeLessThanOrEqual(1024);
    });

    it('view title stays inside the 256-char cap for a maximal display name', () => {
      const character = createTestCharacter({ displayName: 'n'.repeat(255) });
      const { embed } = buildCharacterViewPage(character, 0);
      expect(embed.toJSON().title?.length).toBeLessThanOrEqual(256);
    });
  });

  describe('embed metadata', () => {
    it('should include footer with dates', () => {
      const character = createTestCharacter({
        createdAt: '2024-06-15T00:00:00Z',
        updatedAt: '2024-07-20T00:00:00Z',
      });
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      expect(json.footer?.text).toContain('Created:');
      expect(json.footer?.text).toContain('Updated:');
    });

    it('should have timestamp', () => {
      const character = createTestCharacter();
      const { embed } = buildCharacterViewPage(character, 0);
      const json = embed.toJSON();

      expect(json.timestamp).toBeDefined();
    });
  });
});
