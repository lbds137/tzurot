/**
 * Tests for Character View Page Building
 */

import { describe, it, expect } from 'vitest';
import { _testExports } from './index.js';
import type { CharacterData } from './config.js';
import { DISCORD_LIMITS, TEXT_LIMITS } from '@tzurot/common-types';

const {
  buildCharacterViewPage,
  truncateField,
  buildViewComponents,
  VIEW_TOTAL_PAGES,
  VIEW_PAGE_TITLES,
  EXPANDABLE_FIELDS,
} = _testExports;

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
    voiceEnabled: false,
    imageEnabled: false,
    ownerId: 'owner-123',
    avatarData: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('View Page Constants', () => {
  it('should have exactly 4 pages', () => {
    expect(VIEW_TOTAL_PAGES).toBe(4);
  });

  it('should have 4 page titles matching page count', () => {
    expect(VIEW_PAGE_TITLES).toHaveLength(VIEW_TOTAL_PAGES);
  });

  it('should have correct page titles aligned with edit sections', () => {
    expect(VIEW_PAGE_TITLES[0]).toContain('Identity');
    expect(VIEW_PAGE_TITLES[1]).toContain('Biography');
    expect(VIEW_PAGE_TITLES[2]).toContain('Preferences');
    expect(VIEW_PAGE_TITLES[3]).toContain('Conversation');
  });

  it('should have expandable field definitions for all long fields', () => {
    const expectedFields = [
      'characterInfo',
      'personalityTraits',
      'personalityAppearance',
      'personalityLikes',
      'personalityDislikes',
      'conversationalGoals',
      'conversationalExamples',
      'errorMessage',
    ];

    for (const field of expectedFields) {
      expect(EXPANDABLE_FIELDS[field], `Missing expandable field: ${field}`).toBeDefined();
      expect(EXPANDABLE_FIELDS[field].label).toBeTruthy();
      expect(EXPANDABLE_FIELDS[field].key).toBe(field);
    }
  });
});

describe('truncateField', () => {
  it('should return "_Not set_" for null values', () => {
    const result = truncateField(null);
    expect(result.value).toBe('_Not set_');
    expect(result.wasTruncated).toBe(false);
    expect(result.originalLength).toBe(0);
  });

  it('should return "_Not set_" for undefined values', () => {
    const result = truncateField(undefined);
    expect(result.value).toBe('_Not set_');
    expect(result.wasTruncated).toBe(false);
  });

  it('should return "_Not set_" for empty strings', () => {
    const result = truncateField('');
    expect(result.value).toBe('_Not set_');
    expect(result.wasTruncated).toBe(false);
  });

  it('should not truncate short text', () => {
    const shortText = 'This is a short text';
    const result = truncateField(shortText);
    expect(result.value).toBe(shortText);
    expect(result.wasTruncated).toBe(false);
    expect(result.originalLength).toBe(shortText.length);
  });

  it('should truncate text exceeding default limit', () => {
    // Default max is DISCORD_LIMITS.EMBED_FIELD - suffix length
    const longText = 'x'.repeat(DISCORD_LIMITS.EMBED_FIELD + 100);
    const result = truncateField(longText);

    expect(result.wasTruncated).toBe(true);
    expect(result.originalLength).toBe(longText.length);
    expect(result.value.endsWith(TEXT_LIMITS.TRUNCATION_SUFFIX)).toBe(true);
    expect(result.value.length).toBeLessThanOrEqual(DISCORD_LIMITS.EMBED_FIELD);
  });

  it('should respect custom maxLength', () => {
    const text = 'This is a longer text that should be truncated';
    const result = truncateField(text, 20);

    expect(result.wasTruncated).toBe(true);
    expect(result.value.length).toBeLessThanOrEqual(20 + TEXT_LIMITS.TRUNCATION_SUFFIX.length);
  });

  it('should not exceed Discord embed field limit even with high maxLength', () => {
    const longText = 'x'.repeat(2000);
    const result = truncateField(longText, 5000); // Request more than Discord allows

    expect(result.value.length).toBeLessThanOrEqual(DISCORD_LIMITS.EMBED_FIELD);
  });
});

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

    it('should show settings (visibility, voice, images)', () => {
      const character = createTestCharacter({
        isPublic: true,
        voiceEnabled: true,
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

describe('buildViewComponents', () => {
  it('should include navigation buttons', () => {
    const components = buildViewComponents('test-slug', 1, []);

    expect(components.length).toBeGreaterThan(0);

    // First row should be navigation
    const navRow = components[0];
    const navButtons = navRow.components;

    expect(navButtons.length).toBe(3); // Previous, Page indicator, Next
  });

  it('should disable previous button on first page', () => {
    const components = buildViewComponents('test-slug', 0, []);
    const navRow = components[0];
    const prevButton = navRow.components[0];

    expect(prevButton.data.disabled).toBe(true);
  });

  it('should disable next button on last page', () => {
    const components = buildViewComponents('test-slug', VIEW_TOTAL_PAGES - 1, []);
    const navRow = components[0];
    const nextButton = navRow.components[2];

    expect(nextButton.data.disabled).toBe(true);
  });

  it('should add expand buttons for truncated fields', () => {
    const truncatedFields = ['characterInfo', 'personalityLikes'];
    const components = buildViewComponents('test-slug', 1, truncatedFields);

    // Should have nav row + expand row
    expect(components.length).toBe(2);

    const expandRow = components[1];
    expect(expandRow.components.length).toBe(2);
  });

  it('should not add expand row when no fields are truncated', () => {
    const components = buildViewComponents('test-slug', 0, []);

    expect(components.length).toBe(1); // Only nav row
  });

  it('should limit expand buttons to 5 per row (Discord limit)', () => {
    const manyTruncatedFields = [
      'characterInfo',
      'personalityTraits',
      'personalityAppearance',
      'personalityLikes',
      'personalityDislikes',
      'conversationalGoals',
      'conversationalExamples',
    ];
    const components = buildViewComponents('test-slug', 0, manyTruncatedFields);

    // First row is nav, subsequent rows are expand buttons
    for (let i = 1; i < components.length; i++) {
      expect(components[i].components.length).toBeLessThanOrEqual(5);
    }
  });

  it('should not exceed 5 total rows (Discord limit)', () => {
    const manyTruncatedFields = [
      'characterInfo',
      'personalityTraits',
      'personalityAppearance',
      'personalityLikes',
      'personalityDislikes',
      'conversationalGoals',
      'conversationalExamples',
      'errorMessage',
    ];
    const components = buildViewComponents('test-slug', 0, manyTruncatedFields);

    expect(components.length).toBeLessThanOrEqual(5);
  });
});
