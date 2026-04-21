/**
 * Tests for Character Dashboard Section Definitions
 *
 * Tests the exported section definitions and their getStatus/getPreview logic.
 * Focuses on edge cases and truncation behavior not covered by config.test.ts.
 */

import { describe, it, expect } from 'vitest';
import {
  identitySection,
  biographySection,
  preferencesSection,
  conversationSection,
  adminSection,
} from './sections.js';
import type { CharacterData } from './characterTypes.js';
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
    hasVoiceReference: false,
    imageEnabled: false,
    ownerId: 'owner-123',
    avatarData: null,
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('Character Dashboard Sections', () => {
  describe('identitySection', () => {
    it('should have correct id and fields', () => {
      expect(identitySection.id).toBe('identity');
      expect(identitySection.fieldIds).toHaveLength(5);
    });

    it('should use displayName in preview when available', () => {
      const character = createTestCharacter({ name: 'internal', displayName: 'Display Name' });
      const preview = identitySection.getPreview(character);
      expect(preview).toContain('Display Name');
    });

    it('should use name in preview when displayName is null', () => {
      const character = createTestCharacter({ name: 'Fallback', displayName: null });
      const preview = identitySection.getPreview(character);
      expect(preview).toContain('Fallback');
    });

    it('should include slug in preview', () => {
      const character = createTestCharacter({ slug: 'my-slug' });
      const preview = identitySection.getPreview(character);
      expect(preview).toContain('my-slug');
    });

    it('should omit tone and age from preview when not set', () => {
      const character = createTestCharacter({
        personalityTone: null,
        personalityAge: null,
      });
      const preview = identitySection.getPreview(character);
      expect(preview).not.toContain('🎭');
      expect(preview).not.toContain('📅');
    });
  });

  describe('biographySection', () => {
    it('should have correct id and fields', () => {
      expect(biographySection.id).toBe('biography');
      expect(biographySection.fieldIds).toEqual(['characterInfo', 'personalityAppearance']);
    });

    it('should truncate long text in preview', () => {
      const longText = 'A'.repeat(200);
      const character = createTestCharacter({ characterInfo: longText });
      const preview = biographySection.getPreview(character);
      // Preview truncates to 80 chars, so result should be much shorter
      expect(preview.length).toBeLessThan(200);
      expect(preview).toContain('...');
    });

    it('should show "Not configured" when both fields are empty', () => {
      const character = createTestCharacter({
        characterInfo: '',
        personalityAppearance: null,
      });
      const preview = biographySection.getPreview(character);
      expect(preview).toBe('_Not configured_');
    });
  });

  describe('preferencesSection', () => {
    it('should have correct id and fields', () => {
      expect(preferencesSection.id).toBe('preferences');
      expect(preferencesSection.fieldIds).toEqual(['personalityLikes', 'personalityDislikes']);
    });

    it('should return PARTIAL when only dislikes is set', () => {
      const character = createTestCharacter({
        personalityLikes: null,
        personalityDislikes: 'Loud noises',
      });
      expect(preferencesSection.getStatus(character)).toBe(SectionStatus.PARTIAL);
    });

    it('should truncate long preferences in preview', () => {
      const longLikes = 'B'.repeat(200);
      const character = createTestCharacter({ personalityLikes: longLikes });
      const preview = preferencesSection.getPreview(character);
      expect(preview).toContain('...');
    });

    it('should show "Preferences not set" when both are null', () => {
      const character = createTestCharacter({
        personalityLikes: null,
        personalityDislikes: null,
      });
      const preview = preferencesSection.getPreview(character);
      expect(preview).toBe('_Preferences not set_');
    });
  });

  describe('conversationSection', () => {
    it('should have correct id and fields', () => {
      expect(conversationSection.id).toBe('conversation');
      expect(conversationSection.fieldIds).toEqual([
        'conversationalGoals',
        'conversationalExamples',
        'errorMessage',
      ]);
    });

    it('should show "Default conversation style" when nothing is set', () => {
      const character = createTestCharacter({
        conversationalGoals: null,
        conversationalExamples: null,
        errorMessage: null,
      });
      const preview = conversationSection.getPreview(character);
      expect(preview).toBe('_Default conversation style_');
    });

    it('should return PARTIAL when only goals are set', () => {
      const character = createTestCharacter({
        conversationalGoals: 'Be helpful',
        conversationalExamples: null,
      });
      expect(conversationSection.getStatus(character)).toBe(SectionStatus.PARTIAL);
    });
  });

  describe('adminSection', () => {
    it('should have correct id and slug field', () => {
      expect(adminSection.id).toBe('admin');
      expect(adminSection.fieldIds).toEqual(['slug']);
    });

    it('should always return DEFAULT status', () => {
      const character = createTestCharacter();
      expect(adminSection.getStatus(character)).toBe(SectionStatus.DEFAULT);
    });

    it('should have hidden function on slug field', () => {
      const slugField = adminSection.fields[0];
      expect(typeof slugField.hidden).toBe('function');

      const adminCtx: DashboardContext = { isAdmin: true, userId: 'admin' };
      const userCtx: DashboardContext = { isAdmin: false, userId: 'user' };
      expect((slugField.hidden as (ctx: DashboardContext) => boolean)(adminCtx)).toBe(false);
      expect((slugField.hidden as (ctx: DashboardContext) => boolean)(userCtx)).toBe(true);
    });
  });
});
