/**
 * Tests for Character Dashboard Configuration
 */

import { describe, it, expect } from 'vitest';
import {
  characterDashboardConfig,
  characterSeedFields,
  getCharacterDashboardConfig,
  type CharacterData,
} from './config.js';
import { DISCORD_LIMITS } from '@tzurot/common-types';
import { SectionStatus, type DashboardContext } from '../../utils/dashboard/index.js';

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

describe('Character Dashboard Configuration', () => {
  describe('section structure', () => {
    it('should have exactly 4 sections', () => {
      expect(characterDashboardConfig.sections).toHaveLength(4);
    });

    it('should have sections in correct order', () => {
      const sectionIds = characterDashboardConfig.sections.map(s => s.id);
      expect(sectionIds).toEqual(['identity', 'biography', 'preferences', 'conversation']);
    });

    it('should not exceed Discord modal field limit (5) for any section', () => {
      const DISCORD_MODAL_MAX_FIELDS = 5;

      for (const section of characterDashboardConfig.sections) {
        expect(
          section.fields.length,
          `Section "${section.id}" has ${section.fields.length} fields, max is ${DISCORD_MODAL_MAX_FIELDS}`
        ).toBeLessThanOrEqual(DISCORD_MODAL_MAX_FIELDS);
      }
    });

    it('should have matching fieldIds and fields arrays', () => {
      for (const section of characterDashboardConfig.sections) {
        const fieldIds = section.fields.map(f => f.id);
        expect(fieldIds).toEqual(section.fieldIds);
      }
    });
  });

  describe('Identity & Basics section', () => {
    const identitySection = characterDashboardConfig.sections.find(s => s.id === 'identity')!;

    it('should have correct fields', () => {
      expect(identitySection.fieldIds).toEqual([
        'name',
        'displayName',
        'personalityTraits',
        'personalityTone',
        'personalityAge',
      ]);
    });

    it('should have exactly 5 fields (Discord max)', () => {
      expect(identitySection.fields).toHaveLength(5);
    });

    it('should return COMPLETE when name and traits are set', () => {
      const character = createTestCharacter({
        name: 'Test',
        personalityTraits: 'Some traits',
      });
      expect(identitySection.getStatus(character)).toBe(SectionStatus.COMPLETE);
    });

    it('should return PARTIAL when only name is set', () => {
      const character = createTestCharacter({
        name: 'Test',
        personalityTraits: '',
      });
      expect(identitySection.getStatus(character)).toBe(SectionStatus.PARTIAL);
    });

    it('should return EMPTY when name is empty', () => {
      const character = createTestCharacter({
        name: '',
        personalityTraits: '',
      });
      expect(identitySection.getStatus(character)).toBe(SectionStatus.EMPTY);
    });

    it('should include tone and age in preview when set', () => {
      const character = createTestCharacter({
        name: 'Luna',
        personalityTone: 'playful',
        personalityAge: '25',
      });
      const preview = identitySection.getPreview(character);
      expect(preview).toContain('Luna');
      expect(preview).toContain('playful');
      expect(preview).toContain('25');
    });
  });

  describe('Biography & Appearance section', () => {
    const biographySection = characterDashboardConfig.sections.find(s => s.id === 'biography')!;

    it('should have correct fields', () => {
      expect(biographySection.fieldIds).toEqual(['characterInfo', 'personalityAppearance']);
    });

    it('should have 2 long-form fields', () => {
      expect(biographySection.fields).toHaveLength(2);
      for (const field of biographySection.fields) {
        expect(field.style).toBe('paragraph');
      }
    });

    it('should allow 4000 characters for both fields', () => {
      for (const field of biographySection.fields) {
        expect(field.maxLength).toBe(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH);
      }
    });

    it('should return COMPLETE when both info and appearance are set', () => {
      const character = createTestCharacter({
        characterInfo: 'Background info',
        personalityAppearance: 'Tall with dark hair',
      });
      expect(biographySection.getStatus(character)).toBe(SectionStatus.COMPLETE);
    });

    it('should return PARTIAL when only characterInfo is set', () => {
      const character = createTestCharacter({
        characterInfo: 'Background info',
        personalityAppearance: null,
      });
      expect(biographySection.getStatus(character)).toBe(SectionStatus.PARTIAL);
    });

    it('should return EMPTY when characterInfo is empty', () => {
      const character = createTestCharacter({
        characterInfo: '',
        personalityAppearance: null,
      });
      expect(biographySection.getStatus(character)).toBe(SectionStatus.EMPTY);
    });
  });

  describe('Preferences section', () => {
    const preferencesSection = characterDashboardConfig.sections.find(s => s.id === 'preferences')!;

    it('should have correct fields', () => {
      expect(preferencesSection.fieldIds).toEqual(['personalityLikes', 'personalityDislikes']);
    });

    it('should have 2 long-form fields', () => {
      expect(preferencesSection.fields).toHaveLength(2);
      for (const field of preferencesSection.fields) {
        expect(field.style).toBe('paragraph');
      }
    });

    it('should allow 4000 characters for both fields', () => {
      for (const field of preferencesSection.fields) {
        expect(field.maxLength).toBe(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH);
      }
    });

    it('should return COMPLETE when both likes and dislikes are set', () => {
      const character = createTestCharacter({
        personalityLikes: 'Music, art',
        personalityDislikes: 'Loud noises',
      });
      expect(preferencesSection.getStatus(character)).toBe(SectionStatus.COMPLETE);
    });

    it('should return PARTIAL when only likes is set', () => {
      const character = createTestCharacter({
        personalityLikes: 'Music',
        personalityDislikes: null,
      });
      expect(preferencesSection.getStatus(character)).toBe(SectionStatus.PARTIAL);
    });

    it('should return DEFAULT when neither is set', () => {
      const character = createTestCharacter({
        personalityLikes: null,
        personalityDislikes: null,
      });
      expect(preferencesSection.getStatus(character)).toBe(SectionStatus.DEFAULT);
    });
  });

  describe('Conversation section', () => {
    const conversationSection = characterDashboardConfig.sections.find(
      s => s.id === 'conversation'
    )!;

    it('should have correct fields including errorMessage', () => {
      expect(conversationSection.fieldIds).toEqual([
        'conversationalGoals',
        'conversationalExamples',
        'errorMessage',
      ]);
    });

    it('should have 3 fields', () => {
      expect(conversationSection.fields).toHaveLength(3);
    });

    it('should allow 4000 characters for goals and examples', () => {
      const goalsField = conversationSection.fields.find(f => f.id === 'conversationalGoals')!;
      const examplesField = conversationSection.fields.find(
        f => f.id === 'conversationalExamples'
      )!;

      expect(goalsField.maxLength).toBe(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH);
      expect(examplesField.maxLength).toBe(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH);
    });

    it('should allow 1000 characters for errorMessage', () => {
      const errorField = conversationSection.fields.find(f => f.id === 'errorMessage')!;
      expect(errorField.maxLength).toBe(1000);
    });

    it('should return COMPLETE when goals and examples are set', () => {
      const character = createTestCharacter({
        conversationalGoals: 'Be helpful',
        conversationalExamples: 'User: Hi\nBot: Hello!',
      });
      expect(conversationSection.getStatus(character)).toBe(SectionStatus.COMPLETE);
    });

    it('should return PARTIAL when only errorMessage is set', () => {
      const character = createTestCharacter({
        conversationalGoals: null,
        conversationalExamples: null,
        errorMessage: 'Oops, something went wrong',
      });
      expect(conversationSection.getStatus(character)).toBe(SectionStatus.PARTIAL);
    });

    it('should return DEFAULT when nothing is set', () => {
      const character = createTestCharacter({
        conversationalGoals: null,
        conversationalExamples: null,
        errorMessage: null,
      });
      expect(conversationSection.getStatus(character)).toBe(SectionStatus.DEFAULT);
    });

    it('should show custom error indicator in preview when errorMessage is set', () => {
      const character = createTestCharacter({
        errorMessage: 'Custom error',
      });
      const preview = conversationSection.getPreview(character);
      expect(preview).toContain('Custom error set');
    });
  });

  describe('characterSeedFields', () => {
    it('should have exactly 4 fields for initial creation', () => {
      expect(characterSeedFields).toHaveLength(4);
    });

    it('should include required fields: name, slug, characterInfo, personalityTraits', () => {
      const fieldIds = characterSeedFields.map(f => f.id);
      expect(fieldIds).toEqual(['name', 'slug', 'characterInfo', 'personalityTraits']);
    });

    it('should have all required fields marked as required', () => {
      for (const field of characterSeedFields) {
        expect(field.required, `Field ${field.id} should be required`).toBe(true);
      }
    });

    it('should not exceed Discord modal field limit', () => {
      expect(characterSeedFields.length).toBeLessThanOrEqual(5);
    });
  });

  describe('dashboard config metadata', () => {
    it('should have entityType set to character', () => {
      expect(characterDashboardConfig.entityType).toBe('character');
    });

    it('should generate correct title with display name', () => {
      const character = createTestCharacter({ displayName: 'Luna the Wise' });
      expect(characterDashboardConfig.getTitle(character)).toContain('Luna the Wise');
    });

    it('should generate correct title with name when no displayName', () => {
      const character = createTestCharacter({ name: 'TestBot', displayName: null });
      expect(characterDashboardConfig.getTitle(character)).toContain('TestBot');
    });

    it('should include slug in description', () => {
      const character = createTestCharacter({ slug: 'my-character' });
      expect(characterDashboardConfig.getDescription(character)).toContain('my-character');
    });

    it('should show visibility status in description', () => {
      const publicChar = createTestCharacter({ isPublic: true });
      const privateChar = createTestCharacter({ isPublic: false });

      expect(characterDashboardConfig.getDescription(publicChar)).toContain('Public');
      expect(characterDashboardConfig.getDescription(privateChar)).toContain('Private');
    });

    it('should include footer with dates', () => {
      const character = createTestCharacter({
        createdAt: '2024-06-15T00:00:00Z',
        updatedAt: '2024-07-20T00:00:00Z',
      });
      const footer = characterDashboardConfig.getFooter(character);
      expect(footer).toContain('Created:');
      expect(footer).toContain('Updated:');
    });

    it('should have visibility and avatar actions', () => {
      const actionIds = characterDashboardConfig.actions.map(a => a.id);
      expect(actionIds).toContain('visibility');
      expect(actionIds).toContain('avatar');
    });
  });

  describe('getCharacterDashboardConfig', () => {
    it('should return 4 sections for non-admins', () => {
      const config = getCharacterDashboardConfig(false);
      expect(config.sections).toHaveLength(4);
      const sectionIds = config.sections.map(s => s.id);
      expect(sectionIds).toEqual(['identity', 'biography', 'preferences', 'conversation']);
    });

    it('should return 5 sections for admins (including admin section)', () => {
      const config = getCharacterDashboardConfig(true);
      expect(config.sections).toHaveLength(5);
      const sectionIds = config.sections.map(s => s.id);
      expect(sectionIds).toEqual(['identity', 'biography', 'preferences', 'conversation', 'admin']);
    });

    it('should include admin section only for admins', () => {
      const userConfig = getCharacterDashboardConfig(false);
      const adminConfig = getCharacterDashboardConfig(true);

      expect(userConfig.sections.find(s => s.id === 'admin')).toBeUndefined();
      expect(adminConfig.sections.find(s => s.id === 'admin')).toBeDefined();
    });

    it('should preserve entityType and other config properties', () => {
      const config = getCharacterDashboardConfig(true);
      expect(config.entityType).toBe('character');
      expect(config.getTitle).toBeDefined();
      expect(config.getDescription).toBeDefined();
      expect(config.actions).toBeDefined();
    });
  });

  describe('Admin section', () => {
    const adminConfig = getCharacterDashboardConfig(true);
    const adminSection = adminConfig.sections.find(s => s.id === 'admin')!;

    it('should have slug field', () => {
      expect(adminSection.fieldIds).toEqual(['slug']);
      expect(adminSection.fields).toHaveLength(1);
      expect(adminSection.fields[0].id).toBe('slug');
    });

    it('should have slug field required', () => {
      const slugField = adminSection.fields.find(f => f.id === 'slug')!;
      expect(slugField.required).toBe(true);
    });

    it('should have context-aware hidden property on slug field', () => {
      const slugField = adminSection.fields.find(f => f.id === 'slug')!;
      expect(typeof slugField.hidden).toBe('function');

      // Test the hidden function
      const adminContext: DashboardContext = { isAdmin: true, userId: 'admin-123' };
      const userContext: DashboardContext = { isAdmin: false, userId: 'user-456' };

      // Should be visible to admins (hidden = false)
      expect((slugField.hidden as (ctx: DashboardContext) => boolean)(adminContext)).toBe(false);
      // Should be hidden from non-admins (hidden = true)
      expect((slugField.hidden as (ctx: DashboardContext) => boolean)(userContext)).toBe(true);
    });

    it('should always return DEFAULT status', () => {
      const character = createTestCharacter();
      expect(adminSection.getStatus(character)).toBe(SectionStatus.DEFAULT);
    });

    it('should preview the slug value', () => {
      const character = createTestCharacter({ slug: 'my-character' });
      expect(adminSection.getPreview(character)).toBe('`my-character`');
    });
  });
});
