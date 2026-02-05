/**
 * Personality API Contract Tests
 *
 * These tests verify the contract for personality-related API endpoints.
 * They ensure schemas match expected structure and catch breaking changes.
 */

import { describe, it, expect } from 'vitest';
import {
  EntityPermissionsSchema,
  PersonalitySummarySchema,
  ListPersonalitiesResponseSchema,
  PersonalityCreateSchema,
  PersonalityUpdateSchema,
} from '../schemas/api/index.js';

describe('Personality API Contract Tests', () => {
  describe('EntityPermissionsSchema', () => {
    it('should validate valid permissions object', () => {
      const validPermissions = {
        canEdit: true,
        canDelete: false,
      };

      const result = EntityPermissionsSchema.safeParse(validPermissions);
      expect(result.success).toBe(true);
    });

    it('should validate permissions with all false', () => {
      const permissions = {
        canEdit: false,
        canDelete: false,
      };

      const result = EntityPermissionsSchema.safeParse(permissions);
      expect(result.success).toBe(true);
    });

    it('should validate permissions with all true', () => {
      const permissions = {
        canEdit: true,
        canDelete: true,
      };

      const result = EntityPermissionsSchema.safeParse(permissions);
      expect(result.success).toBe(true);
    });

    it('should reject missing canEdit', () => {
      const invalidPermissions = {
        canDelete: true,
      };

      const result = EntityPermissionsSchema.safeParse(invalidPermissions);
      expect(result.success).toBe(false);
    });

    it('should reject missing canDelete', () => {
      const invalidPermissions = {
        canEdit: true,
      };

      const result = EntityPermissionsSchema.safeParse(invalidPermissions);
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean values', () => {
      const invalidPermissions = {
        canEdit: 'yes',
        canDelete: 1,
      };

      const result = EntityPermissionsSchema.safeParse(invalidPermissions);
      expect(result.success).toBe(false);
    });
  });

  describe('PersonalitySummarySchema', () => {
    const validSummary = {
      id: '33333333-3333-5333-8333-333333333333',
      name: 'TestCharacter',
      displayName: 'Test Character',
      slug: 'test-character',
      isOwned: true,
      isPublic: false,
      ownerId: '44444444-4444-5444-8444-444444444444',
      ownerDiscordId: '123456789012345678',
      permissions: { canEdit: true, canDelete: true },
    };

    it('should validate a complete personality summary', () => {
      const result = PersonalitySummarySchema.safeParse(validSummary);
      expect(result.success).toBe(true);
    });

    it('should validate summary with null displayName', () => {
      const summary = { ...validSummary, displayName: null };

      const result = PersonalitySummarySchema.safeParse(summary);
      expect(result.success).toBe(true);
    });

    it('should validate summary with null ownerId', () => {
      const summary = { ...validSummary, ownerId: null };

      const result = PersonalitySummarySchema.safeParse(summary);
      expect(result.success).toBe(true);
    });

    it('should validate summary with null ownerDiscordId', () => {
      const summary = { ...validSummary, ownerDiscordId: null };

      const result = PersonalitySummarySchema.safeParse(summary);
      expect(result.success).toBe(true);
    });

    it('should validate non-owned public personality', () => {
      const summary = {
        ...validSummary,
        isOwned: false,
        isPublic: true,
        permissions: { canEdit: false, canDelete: false },
      };

      const result = PersonalitySummarySchema.safeParse(summary);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID for id', () => {
      const invalidSummary = { ...validSummary, id: 'not-a-uuid' };

      const result = PersonalitySummarySchema.safeParse(invalidSummary);
      expect(result.success).toBe(false);
    });

    it('should reject missing permissions', () => {
      const { permissions: _permissions, ...summaryWithoutPermissions } = validSummary;

      const result = PersonalitySummarySchema.safeParse(summaryWithoutPermissions);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const incompleteSummary = {
        id: validSummary.id,
        name: validSummary.name,
        // Missing: displayName, slug, isOwned, isPublic, ownerId, ownerDiscordId, permissions
      };

      const result = PersonalitySummarySchema.safeParse(incompleteSummary);
      expect(result.success).toBe(false);
    });
  });

  describe('ListPersonalitiesResponseSchema', () => {
    it('should validate empty personalities list', () => {
      const response = { personalities: [] };

      const result = ListPersonalitiesResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should validate list with multiple personalities', () => {
      const response = {
        personalities: [
          {
            id: '11111111-1111-5111-8111-111111111111',
            name: 'Character1',
            displayName: 'Character One',
            slug: 'character-1',
            isOwned: true,
            isPublic: false,
            ownerId: '44444444-4444-5444-8444-444444444444',
            ownerDiscordId: '123456789012345678',
            permissions: { canEdit: true, canDelete: true },
          },
          {
            id: '22222222-2222-5222-8222-222222222222',
            name: 'Character2',
            displayName: null,
            slug: 'character-2',
            isOwned: false,
            isPublic: true,
            ownerId: '55555555-5555-5555-8555-555555555555',
            ownerDiscordId: '987654321098765432',
            permissions: { canEdit: false, canDelete: false },
          },
        ],
      };

      const result = ListPersonalitiesResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should reject response without personalities array', () => {
      const invalidResponse = {};

      const result = ListPersonalitiesResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('Contract Documentation', () => {
    it('should document the permissions DTO pattern', () => {
      // This test serves as documentation:
      //
      // PERMISSIONS DTO PATTERN:
      // - `isOwned`: Truthful attribution - "Did I create this?"
      // - `permissions.canEdit`: Authorization - "Can I modify this?"
      // - `permissions.canDelete`: Authorization - "Can I delete this?"
      //
      // IMPORTANT DISTINCTION:
      // - Bot owner sees `isOwned: false` for others' personalities
      // - But `permissions.canEdit: true` because they have admin rights
      // - This separates attribution from authorization
      //
      // BENEFITS:
      // - Single source of truth: Backend computes permissions
      // - Role extensibility: Adding moderators only requires backend changes
      // - No scattered `isOwned || isBotOwner()` checks in bot-client

      expect(true).toBe(true);
    });
  });

  describe('PersonalityCreateSchema', () => {
    const validCreateInput = {
      name: 'Test Character',
      slug: 'test-character',
      characterInfo: 'A test character for testing',
      personalityTraits: 'Friendly, helpful, curious',
    };

    it('should validate complete create input with required fields only', () => {
      const result = PersonalityCreateSchema.safeParse(validCreateInput);
      expect(result.success).toBe(true);
    });

    it('should validate create input with all optional fields', () => {
      const fullInput = {
        ...validCreateInput,
        displayName: 'Test Display Name',
        personalityTone: 'Friendly and warm',
        personalityAge: '25',
        personalityAppearance: 'Tall with dark hair',
        personalityLikes: 'Reading, coding',
        personalityDislikes: 'Spam messages',
        conversationalGoals: 'Help users with tasks',
        conversationalExamples: 'User: Hello\nBot: Hi there!',
        errorMessage: 'I encountered an issue',
        isPublic: true,
        customFields: { favoriteColor: 'blue' },
        avatarData: 'base64encodeddata',
      };

      const result = PersonalityCreateSchema.safeParse(fullInput);
      expect(result.success).toBe(true);
    });

    it('should reject missing required field: name', () => {
      const { name: _name, ...inputWithoutName } = validCreateInput;
      const result = PersonalityCreateSchema.safeParse(inputWithoutName);
      expect(result.success).toBe(false);
    });

    it('should reject missing required field: slug', () => {
      const { slug: _slug, ...inputWithoutSlug } = validCreateInput;
      const result = PersonalityCreateSchema.safeParse(inputWithoutSlug);
      expect(result.success).toBe(false);
    });

    it('should reject missing required field: characterInfo', () => {
      const { characterInfo: _info, ...inputWithoutInfo } = validCreateInput;
      const result = PersonalityCreateSchema.safeParse(inputWithoutInfo);
      expect(result.success).toBe(false);
    });

    it('should reject missing required field: personalityTraits', () => {
      const { personalityTraits: _traits, ...inputWithoutTraits } = validCreateInput;
      const result = PersonalityCreateSchema.safeParse(inputWithoutTraits);
      expect(result.success).toBe(false);
    });

    it('should reject slug that is too short', () => {
      const input = { ...validCreateInput, slug: 'ab' };
      const result = PersonalityCreateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject slug with invalid characters', () => {
      const input = { ...validCreateInput, slug: 'Test_Character!' };
      const result = PersonalityCreateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject slug starting with number', () => {
      const input = { ...validCreateInput, slug: '1test-character' };
      const result = PersonalityCreateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should accept slug with numbers after first character', () => {
      const input = { ...validCreateInput, slug: 'test-character-123' };
      const result = PersonalityCreateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it('should reject name exceeding 100 characters', () => {
      const input = { ...validCreateInput, name: 'a'.repeat(101) };
      const result = PersonalityCreateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should transform empty displayName to null', () => {
      const input = { ...validCreateInput, displayName: '' };
      const result = PersonalityCreateSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBeNull();
      }
    });

    it('should validate isPublic as boolean', () => {
      const inputTrue = { ...validCreateInput, isPublic: true };
      const inputFalse = { ...validCreateInput, isPublic: false };

      expect(PersonalityCreateSchema.safeParse(inputTrue).success).toBe(true);
      expect(PersonalityCreateSchema.safeParse(inputFalse).success).toBe(true);
    });
  });

  describe('PersonalityUpdateSchema', () => {
    it('should validate empty update (no changes)', () => {
      const result = PersonalityUpdateSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should validate partial update with single field', () => {
      const result = PersonalityUpdateSchema.safeParse({ name: 'New Name' });
      expect(result.success).toBe(true);
    });

    it('should validate update with all fields', () => {
      const fullUpdate = {
        name: 'Updated Name',
        slug: 'updated-slug',
        displayName: 'Updated Display',
        characterInfo: 'Updated info',
        personalityTraits: 'Updated traits',
        personalityTone: 'Updated tone',
        personalityAge: '30',
        personalityAppearance: 'Updated appearance',
        personalityLikes: 'Updated likes',
        personalityDislikes: 'Updated dislikes',
        conversationalGoals: 'Updated goals',
        conversationalExamples: 'Updated examples',
        errorMessage: 'Updated error',
        isPublic: true,
        customFields: { newField: 'value' },
        avatarData: 'newbase64data',
        extendedContext: true,
        extendedContextMaxMessages: 50,
        extendedContextMaxAge: 3600,
        extendedContextMaxImages: 5,
      };

      const result = PersonalityUpdateSchema.safeParse(fullUpdate);
      expect(result.success).toBe(true);
    });

    it('should transform empty string displayName to null', () => {
      const result = PersonalityUpdateSchema.safeParse({ displayName: '' });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.displayName).toBeNull();
      }
    });

    it('should validate isPublic toggle', () => {
      const toggleOn = PersonalityUpdateSchema.safeParse({ isPublic: true });
      const toggleOff = PersonalityUpdateSchema.safeParse({ isPublic: false });

      expect(toggleOn.success).toBe(true);
      expect(toggleOff.success).toBe(true);
    });

    it('should validate extendedContext settings', () => {
      const result = PersonalityUpdateSchema.safeParse({
        extendedContext: true,
        extendedContextMaxMessages: 100,
        extendedContextMaxAge: 86400,
        extendedContextMaxImages: 10,
      });
      expect(result.success).toBe(true);
    });

    it('should allow null for extendedContext settings', () => {
      const result = PersonalityUpdateSchema.safeParse({
        extendedContext: null,
        extendedContextMaxMessages: null,
        extendedContextMaxAge: null,
        extendedContextMaxImages: null,
      });
      expect(result.success).toBe(true);
    });

    it('should reject negative extendedContextMaxMessages', () => {
      const result = PersonalityUpdateSchema.safeParse({
        extendedContextMaxMessages: -1,
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative extendedContextMaxImages', () => {
      const result = PersonalityUpdateSchema.safeParse({
        extendedContextMaxImages: -1,
      });
      expect(result.success).toBe(false);
    });
  });
});
