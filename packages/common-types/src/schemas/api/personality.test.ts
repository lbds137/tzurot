/**
 * Personality API Contract Tests
 *
 * These tests verify the contract for personality-related API endpoints.
 * They ensure schemas match expected structure and catch breaking changes.
 */

import { describe, it, expect } from 'vitest';
import { DISCORD_LIMITS } from '../../constants/discord.js';
import { EntityPermissionsSchema } from './shared.js';
import {
  PersonalitySummarySchema,
  PersonalityFullSchema,
  PersonalityCharacterFieldsSchema,
  ListPersonalitiesResponseSchema,
  CreatePersonalityResponseSchema,
  GetPersonalityResponseSchema,
  DeletePersonalityResponseSchema,
  PersonalityCreateSchema,
  PersonalityUpdateSchema,
  AdminPersonalityResponseSchema,
  SetVisibilitySchema,
  PERSONALITY_DETAIL_SELECT,
  PERSONALITY_LIST_SELECT,
  TAG_LIMITS,
  TAG_INPUT_LIMITS,
  MAX_JOINED_TAGS_LENGTH,
  normalizeTag,
  PersonalityTagSchema,
  PersonalityTagsInputSchema,
  AddPersonalityAliasRequestSchema,
  AddPersonalityAliasResponseSchema,
  AliasScopeSchema,
  ListMyAliasesResponseSchema,
  MyAliasEntrySchema,
  ListPersonalityAliasesResponseSchema,
  PersonalityAliasEntrySchema,
  RemovePersonalityAliasResponseSchema,
} from './personality.js';

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

  describe('PersonalityCharacterFieldsSchema', () => {
    it('should accept all null values (all fields are nullable)', () => {
      const result = PersonalityCharacterFieldsSchema.safeParse({
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        errorMessage: null,
      });
      expect(result.success).toBe(true);
    });

    it('should accept string values and transform empty strings to null', () => {
      const result = PersonalityCharacterFieldsSchema.safeParse({
        personalityTone: 'Warm and friendly',
        personalityAge: '',
        personalityAppearance: null,
        personalityLikes: 'Coding',
        personalityDislikes: undefined,
        conversationalGoals: null,
        conversationalExamples: 'Example dialogue',
        errorMessage: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.personalityTone).toBe('Warm and friendly');
        expect(result.data.personalityAge).toBeNull(); // empty → null
      }
    });

    it('should have exactly 8 fields', () => {
      const keys = Object.keys(PersonalityCharacterFieldsSchema.shape);
      expect(keys).toHaveLength(8);
      expect(keys).toContain('personalityTone');
      expect(keys).toContain('errorMessage');
    });

    it('should reject personalityTone exceeding SHORT_PARAGRAPH_MAX_LENGTH', () => {
      const result = PersonalityCharacterFieldsSchema.safeParse({
        personalityTone: 'x'.repeat(DISCORD_LIMITS.SHORT_PARAGRAPH_MAX_LENGTH + 1),
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        errorMessage: null,
      });
      expect(result.success).toBe(false);
    });

    it('should reject errorMessage exceeding SHORT_PARAGRAPH_MAX_LENGTH', () => {
      const result = PersonalityCharacterFieldsSchema.safeParse({
        personalityTone: null,
        personalityAge: null,
        personalityAppearance: null,
        personalityLikes: null,
        personalityDislikes: null,
        conversationalGoals: null,
        conversationalExamples: null,
        errorMessage: 'x'.repeat(DISCORD_LIMITS.SHORT_PARAGRAPH_MAX_LENGTH + 1),
      });
      expect(result.success).toBe(false);
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

    it('should reject personalityTraits exceeding SHORT_PARAGRAPH_MAX_LENGTH', () => {
      const input = {
        ...validCreateInput,
        personalityTraits: 'x'.repeat(DISCORD_LIMITS.SHORT_PARAGRAPH_MAX_LENGTH + 1),
      };
      const result = PersonalityCreateSchema.safeParse(input);
      expect(result.success).toBe(false);
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

    it('should accept null avatarData / voiceReferenceData (no media provided)', () => {
      const result = PersonalityCreateSchema.safeParse({
        ...validCreateInput,
        avatarData: null,
        voiceReferenceData: null,
      });
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

    it('should reject slug that is too long (> 50)', () => {
      const input = { ...validCreateInput, slug: `a${'b'.repeat(50)}` }; // 51 chars
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

    it('should reject name exceeding 255 characters', () => {
      const input = { ...validCreateInput, name: 'a'.repeat(256) };
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
      };

      const result = PersonalityUpdateSchema.safeParse(fullUpdate);
      expect(result.success).toBe(true);
    });

    it('should accept avatarData as null (no-avatar round-trip)', () => {
      // Regression: a character with no avatar has avatarData=null, and the
      // dashboard round-trips it on every section save (it only fetches
      // `hasAvatar`, never the base64). Rejecting null here 400'd every edit of
      // a no-avatar character with "expected string, received null".
      const result = PersonalityUpdateSchema.safeParse({ name: 'New Name', avatarData: null });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.avatarData).toBeNull();
      }
    });

    it('should accept voiceReferenceData as string (set new)', () => {
      const result = PersonalityUpdateSchema.safeParse({
        voiceReferenceData: 'data:audio/wav;base64,AAAA',
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.voiceReferenceData).toBe('data:audio/wav;base64,AAAA');
      }
    });

    it('should accept voiceReferenceData as null (clear existing)', () => {
      const result = PersonalityUpdateSchema.safeParse({
        voiceReferenceData: null,
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.voiceReferenceData).toBeNull();
      }
    });

    it('should accept voiceReferenceData as undefined (no change)', () => {
      const result = PersonalityUpdateSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.voiceReferenceData).toBeUndefined();
      }
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
  });

  describe('AdminPersonalityResponseSchema', () => {
    const validResponse = {
      success: true as const,
      personality: {
        id: '33333333-3333-5333-8333-333333333333',
        name: 'Test Character',
        slug: 'test-character',
        displayName: 'Test Display Name',
        hasAvatar: true,
      },
      timestamp: '2026-02-04T12:00:00.000Z',
    };

    it('should validate complete admin response', () => {
      const result = AdminPersonalityResponseSchema.safeParse(validResponse);
      expect(result.success).toBe(true);
    });

    it('should validate response with null displayName', () => {
      const response = {
        ...validResponse,
        personality: { ...validResponse.personality, displayName: null },
      };
      const result = AdminPersonalityResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should validate response with hasAvatar false', () => {
      const response = {
        ...validResponse,
        personality: { ...validResponse.personality, hasAvatar: false },
      };
      const result = AdminPersonalityResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID for personality id', () => {
      const response = {
        ...validResponse,
        personality: { ...validResponse.personality, id: 'not-a-uuid' },
      };
      const result = AdminPersonalityResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });

    it('should reject success not being literal true', () => {
      const response = { ...validResponse, success: false };
      const result = AdminPersonalityResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });

    it('should reject invalid timestamp format', () => {
      const response = { ...validResponse, timestamp: 'not-a-timestamp' };
      const result = AdminPersonalityResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });

    it('should reject missing personality object', () => {
      const { personality: _p, ...responseWithoutPersonality } = validResponse;
      const result = AdminPersonalityResponseSchema.safeParse(responseWithoutPersonality);
      expect(result.success).toBe(false);
    });

    it('should reject missing required personality fields', () => {
      const response = {
        ...validResponse,
        personality: { id: validResponse.personality.id },
      };
      const result = AdminPersonalityResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });
  });

  describe('PersonalityFullSchema', () => {
    const validFull = {
      id: '33333333-3333-5333-8333-333333333333',
      name: 'Test Character',
      slug: 'test-character',
      displayName: 'Test Display',
      characterInfo: 'A test character',
      personalityTraits: 'Friendly',
      personalityTone: 'Warm',
      personalityAge: '25',
      personalityAppearance: 'Tall',
      personalityLikes: 'Coding',
      personalityDislikes: 'Spam',
      conversationalGoals: 'Help users',
      conversationalExamples: 'User: Hi\nBot: Hello!',
      errorMessage: 'Something went wrong',
      birthMonth: 6,
      birthDay: 15,
      birthYear: 1999,
      isPublic: false,
      definitionPublic: false,
      definitionRedacted: false,
      voiceEnabled: true,
      imageEnabled: false,
      ownerId: '44444444-4444-5444-8444-444444444444',
      hasAvatar: true,
      avatarUrl: 'https://public.example/avatars/test-character-1737385800000.png',
      hasVoiceReference: false,
      customFields: null,
      createdAt: '2025-01-15T12:00:00.000Z',
      updatedAt: '2025-01-20T15:30:00.000Z',
    };

    it('should validate complete personality data', () => {
      const result = PersonalityFullSchema.safeParse(validFull);
      expect(result.success).toBe(true);
    });

    it('avatarUrl survives the parse (strip-mode deletes undeclared fields)', () => {
      // The pin that matters for the V2 thumbnail: an undeclared field would
      // parse fine and silently vanish — the bot would render no avatar with
      // every unit test green.
      const result = PersonalityFullSchema.safeParse(validFull);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.avatarUrl).toBe(
          'https://public.example/avatars/test-character-1737385800000.png'
        );
      }
    });

    it('accepts null avatarUrl (no avatar)', () => {
      const result = PersonalityFullSchema.safeParse({ ...validFull, avatarUrl: null });
      expect(result.success).toBe(true);
    });

    it('should validate with all nullable fields as null', () => {
      const data = {
        ...validFull,
        displayName: null,
        characterInfo: null,
        personalityTraits: null,
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
      };
      const result = PersonalityFullSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID for id', () => {
      const data = { ...validFull, id: 'not-a-uuid' };
      const result = PersonalityFullSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject invalid datetime for createdAt', () => {
      const data = { ...validFull, createdAt: 'not-a-date' };
      const result = PersonalityFullSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const result = PersonalityFullSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('CreatePersonalityResponseSchema', () => {
    const validFull = {
      id: '33333333-3333-5333-8333-333333333333',
      name: 'New Character',
      slug: 'new-character',
      displayName: null,
      characterInfo: 'A new character',
      personalityTraits: 'Helpful',
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
      voiceEnabled: false,
      imageEnabled: false,
      ownerId: '44444444-4444-5444-8444-444444444444',
      hasAvatar: false,
      avatarUrl: null,
      hasVoiceReference: false,
      customFields: null,
      createdAt: '2025-01-15T12:00:00.000Z',
      updatedAt: '2025-01-15T12:00:00.000Z',
    };

    it('should validate create response', () => {
      const data = { success: true as const, personality: validFull };
      const result = CreatePersonalityResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject success=false', () => {
      const data = { success: false, personality: validFull };
      const result = CreatePersonalityResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('GetPersonalityResponseSchema', () => {
    const validFull = {
      id: '33333333-3333-5333-8333-333333333333',
      name: 'Test Character',
      slug: 'test-character',
      displayName: 'Test',
      characterInfo: 'Info',
      personalityTraits: 'Traits',
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
      isPublic: true,
      definitionPublic: false,
      definitionRedacted: false,
      voiceEnabled: false,
      imageEnabled: false,
      ownerId: '44444444-4444-5444-8444-444444444444',
      hasAvatar: false,
      avatarUrl: null,
      hasVoiceReference: false,
      customFields: null,
      createdAt: '2025-01-15T12:00:00.000Z',
      updatedAt: '2025-01-15T12:00:00.000Z',
    };

    it('should validate get response', () => {
      const data = { personality: validFull, canEdit: true };
      const result = GetPersonalityResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('parse KEEPS customFields (typed clients strip undeclared keys)', () => {
      // The typed client returns validation.data — Zod's default strip mode
      // silently drops any key not declared on the schema. customFields was
      // undeclared once, so the gateway sent it and every client threw it
      // away (breaking the export round-trip). This pins the declaration.
      const data = {
        personality: { ...validFull, customFields: { lore: 'deep', tags: ['a'] } },
        canEdit: true,
      };
      const result = GetPersonalityResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.personality.customFields).toEqual({ lore: 'deep', tags: ['a'] });
      }
    });

    it('should reject missing canEdit', () => {
      const data = { personality: validFull };
      const result = GetPersonalityResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing personality', () => {
      const result = GetPersonalityResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('DeletePersonalityResponseSchema', () => {
    it('should validate delete response with counts', () => {
      const data = {
        success: true as const,
        deletedSlug: 'test-character',
        deletedName: 'Test Character',
        deletedCounts: {
          conversationHistory: 42,
          memories: 10,
          pendingMemories: 2,
          channelSettings: 3,
          aliases: 1,
        },
      };
      const result = DeletePersonalityResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should validate delete response with zero counts', () => {
      const data = {
        success: true as const,
        deletedSlug: 'empty-char',
        deletedName: 'Empty Character',
        deletedCounts: {
          conversationHistory: 0,
          memories: 0,
          pendingMemories: 0,
          channelSettings: 0,
          aliases: 0,
        },
      };
      const result = DeletePersonalityResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject negative counts', () => {
      const data = {
        success: true as const,
        deletedSlug: 'test',
        deletedName: 'Test',
        deletedCounts: {
          conversationHistory: -1,
          memories: 0,
          pendingMemories: 0,
          channelSettings: 0,
          aliases: 0,
        },
      };
      const result = DeletePersonalityResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject success=false', () => {
      const data = {
        success: false,
        deletedSlug: 'test',
        deletedName: 'Test',
        deletedCounts: {
          conversationHistory: 0,
          memories: 0,
          pendingMemories: 0,
          channelSettings: 0,
          aliases: 0,
        },
      };
      const result = DeletePersonalityResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing deletedCounts', () => {
      const data = {
        success: true as const,
        deletedSlug: 'test',
        deletedName: 'Test',
      };
      const result = DeletePersonalityResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('PERSONALITY_DETAIL_SELECT', () => {
    it('should NOT include voiceReferenceData blob (uses voiceReferenceType as proxy)', () => {
      expect(PERSONALITY_DETAIL_SELECT).not.toHaveProperty('voiceReferenceData');
      expect(PERSONALITY_DETAIL_SELECT).toHaveProperty('voiceReferenceType', true);
    });

    it('should include avatarData for filesystem caching', () => {
      expect(PERSONALITY_DETAIL_SELECT).toHaveProperty('avatarData', true);
    });
  });

  describe('SetVisibilitySchema', () => {
    it('should accept isPublic: true', () => {
      const result = SetVisibilitySchema.safeParse({ isPublic: true });
      expect(result.success).toBe(true);
    });

    it('should accept isPublic: false', () => {
      const result = SetVisibilitySchema.safeParse({ isPublic: false });
      expect(result.success).toBe(true);
    });

    it('should reject non-boolean value', () => {
      const result = SetVisibilitySchema.safeParse({ isPublic: 'true' });
      expect(result.success).toBe(false);
    });

    it('should reject missing isPublic', () => {
      const result = SetVisibilitySchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});

describe('Personality alias schemas', () => {
  it('AddPersonalityAliasRequestSchema trims and accepts a plain alias', () => {
    const parsed = AddPersonalityAliasRequestSchema.parse({ alias: '  Lila  ' });
    expect(parsed.alias).toBe('Lila');
  });

  it('defaults scope to "user" (personal) when omitted; accepts explicit tiers', () => {
    expect(AddPersonalityAliasRequestSchema.parse({ alias: 'Lila' }).scope).toBe('user');
    expect(AddPersonalityAliasRequestSchema.parse({ alias: 'Lila', scope: 'global' }).scope).toBe(
      'global'
    );
    expect(
      AddPersonalityAliasRequestSchema.safeParse({ alias: 'Lila', scope: 'everyone' }).success
    ).toBe(false);
  });

  it('rejects an alias containing "@" anywhere (mention parser splits on it)', () => {
    expect(AddPersonalityAliasRequestSchema.safeParse({ alias: '@Lila' }).success).toBe(false);
    expect(AddPersonalityAliasRequestSchema.safeParse({ alias: 'Li@la' }).success).toBe(false);
  });

  it('rejects empty-after-trim and over-column-width aliases', () => {
    expect(AddPersonalityAliasRequestSchema.safeParse({ alias: '   ' }).success).toBe(false);
    expect(AddPersonalityAliasRequestSchema.safeParse({ alias: 'x'.repeat(101) }).success).toBe(
      false
    );
  });

  it('ListPersonalityAliasesResponseSchema requires scope + truncated + ISO createdAt', () => {
    expect(
      ListPersonalityAliasesResponseSchema.safeParse({
        aliases: [{ alias: 'lila', scope: 'global', createdAt: '2026-07-17T00:00:00.000Z' }],
        truncated: false,
      }).success
    ).toBe(true);
    // Missing truncated
    expect(
      ListPersonalityAliasesResponseSchema.safeParse({
        aliases: [{ alias: 'lila', scope: 'global', createdAt: '2026-07-17T00:00:00.000Z' }],
      }).success
    ).toBe(false);
    expect(
      ListPersonalityAliasesResponseSchema.safeParse({
        aliases: [{ alias: 'lila', scope: 'global', createdAt: 'yesterday' }],
        truncated: false,
      }).success
    ).toBe(false);
  });

  it('RemovePersonalityAliasResponseSchema carries the removed alias + its tier back', () => {
    expect(
      RemovePersonalityAliasResponseSchema.safeParse({ removedAlias: 'lila', removedScope: 'user' })
        .success
    ).toBe(true);
    expect(RemovePersonalityAliasResponseSchema.safeParse({ removedAlias: 'lila' }).success).toBe(
      false
    );
  });
});

describe('PersonalityAliasEntrySchema', () => {
  it('accepts a well-formed entry and rejects a non-ISO createdAt', () => {
    expect(
      PersonalityAliasEntrySchema.safeParse({
        alias: 'lila',
        scope: 'user',
        createdAt: '2026-07-17T00:00:00.000Z',
      }).success
    ).toBe(true);
    expect(
      PersonalityAliasEntrySchema.safeParse({
        alias: 'lila',
        scope: 'user',
        createdAt: 'yesterday',
      }).success
    ).toBe(false);
  });
});

describe('AddPersonalityAliasResponseSchema', () => {
  it('wraps a single created entry', () => {
    expect(
      AddPersonalityAliasResponseSchema.safeParse({
        alias: { alias: 'li', scope: 'user', createdAt: '2026-07-17T00:00:00.000Z' },
      }).success
    ).toBe(true);
    expect(AddPersonalityAliasResponseSchema.safeParse({ alias: 'bare-string' }).success).toBe(
      false
    );
  });
});

describe('AliasScopeSchema', () => {
  it('accepts exactly the two tiers', () => {
    expect(AliasScopeSchema.parse('global')).toBe('global');
    expect(AliasScopeSchema.parse('user')).toBe('user');
    expect(AliasScopeSchema.safeParse('everyone').success).toBe(false);
    expect(AliasScopeSchema.safeParse('').success).toBe(false);
  });
});

describe('MyAliasEntrySchema', () => {
  it('requires the personality context object with id/name/slug', () => {
    expect(
      MyAliasEntrySchema.safeParse({
        alias: 'mommy',
        scope: 'user',
        personality: { id: 'p-1', name: 'Lilith', slug: 'lilith' },
        shadowed: false,
        createdAt: '2026-07-18T00:00:00.000Z',
      }).success
    ).toBe(true);
    expect(
      MyAliasEntrySchema.safeParse({
        alias: 'mommy',
        scope: 'user',
        personality: { id: 'p-1' },
        shadowed: false,
        createdAt: '2026-07-18T00:00:00.000Z',
      }).success
    ).toBe(false);
  });
});

describe('ListMyAliasesResponseSchema', () => {
  it('accepts entries with personality context + shadowed flag', () => {
    expect(
      ListMyAliasesResponseSchema.safeParse({
        aliases: [
          {
            alias: 'mommy',
            scope: 'user',
            personality: { id: 'p-1', name: 'Lilith', slug: 'lilith' },
            shadowed: false,
            createdAt: '2026-07-18T00:00:00.000Z',
          },
        ],
        truncated: false,
      }).success
    ).toBe(true);
  });

  it('rejects entries missing the shadowed flag (the badge signal is not optional)', () => {
    expect(
      ListMyAliasesResponseSchema.safeParse({
        aliases: [
          {
            alias: 'mommy',
            scope: 'user',
            personality: { id: 'p-1', name: 'Lilith', slug: 'lilith' },
            createdAt: '2026-07-18T00:00:00.000Z',
          },
        ],
        truncated: false,
      }).success
    ).toBe(false);
  });
});

// ============================================================================
// Character tags
// ============================================================================

describe('normalizeTag', () => {
  it('trims, lowercases, and collapses internal whitespace runs to one hyphen', () => {
    expect(normalizeTag('  Sci   Fi  ')).toBe('sci-fi');
    expect(normalizeTag('FANTASY')).toBe('fantasy');
    expect(normalizeTag('slice of life')).toBe('slice-of-life');
  });

  it('leaves an already-normalized tag untouched', () => {
    expect(normalizeTag('sci-fi')).toBe('sci-fi');
  });

  it('collapses a tab run the same as spaces', () => {
    expect(normalizeTag('dark\tfantasy')).toBe('dark-fantasy');
  });

  it('collapses hyphen runs — the hyphen is OUR separator, so runs are noise', () => {
    expect(normalizeTag('sci--fi')).toBe('sci-fi');
    expect(normalizeTag('sci -- fi')).toBe('sci-fi');
  });

  it('trims leading and trailing hyphens', () => {
    expect(normalizeTag('anime-')).toBe('anime');
    expect(normalizeTag('-anime')).toBe('anime');
    expect(normalizeTag('-x-')).toBe('x');
  });

  it('leaves a content character alone — only the separator gets hygiene', () => {
    expect(normalizeTag('Sci Fi!')).toBe('sci-fi!');
  });
});

describe('PersonalityTagSchema', () => {
  it('normalizes before validating, so a spaced tag is accepted', () => {
    const result = PersonalityTagSchema.safeParse('  Sci Fi ');
    expect(result.success).toBe(true);
    expect(result.data).toBe('sci-fi');
  });

  it('rejects a tag shorter than the minimum', () => {
    expect(PersonalityTagSchema.safeParse('a').success).toBe(false);
  });

  it('rejects a tag longer than the maximum', () => {
    expect(PersonalityTagSchema.safeParse('x'.repeat(TAG_LIMITS.MAX_LENGTH + 1)).success).toBe(
      false
    );
  });

  it('accepts a tag exactly at each length bound', () => {
    expect(PersonalityTagSchema.safeParse('x'.repeat(TAG_LIMITS.MIN_LENGTH)).success).toBe(true);
    expect(PersonalityTagSchema.safeParse('x'.repeat(TAG_LIMITS.MAX_LENGTH)).success).toBe(true);
  });

  it('rejects characters outside the pattern rather than silently stripping them', () => {
    expect(PersonalityTagSchema.safeParse('sci-fi!').success).toBe(false);
    expect(PersonalityTagSchema.safeParse('under_score').success).toBe(false);
  });

  it('accepts a leading hyphen by trimming it, and accepts a leading digit', () => {
    // Normalization strips the edge hyphen, so the pattern never sees it.
    expect(PersonalityTagSchema.safeParse('-fantasy').data).toBe('fantasy');
    expect(PersonalityTagSchema.safeParse('90s-anime').success).toBe(true);
  });

  it('rejects a hyphen-trimmed tag that falls under the minimum length', () => {
    // '-x-' normalizes to 'x' (1 char), which the min-length check rejects.
    expect(PersonalityTagSchema.safeParse('-x-').success).toBe(false);
  });

  it('rejects an all-hyphen token, which normalizes to empty', () => {
    expect(PersonalityTagSchema.safeParse('---').success).toBe(false);
  });
});

describe('PersonalityTagsInputSchema', () => {
  it('splits a comma-separated string into normalized tags', () => {
    const result = PersonalityTagsInputSchema.safeParse('Fantasy, Sci Fi ,comedy');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['fantasy', 'sci-fi', 'comedy']);
  });

  it('accepts an array and normalizes each entry', () => {
    const result = PersonalityTagsInputSchema.safeParse(['Fantasy', ' Sci Fi ']);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['fantasy', 'sci-fi']);
  });

  it('drops empty tokens from a trailing or doubled comma', () => {
    const result = PersonalityTagsInputSchema.safeParse('fantasy,,comedy, ');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['fantasy', 'comedy']);
  });

  it('dedupes after normalization, preserving first-seen order', () => {
    const result = PersonalityTagsInputSchema.safeParse('Comedy, fantasy, COMEDY, Sci Fi, sci-fi');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['comedy', 'fantasy', 'sci-fi']);
  });

  it('accepts an empty string and an empty array as "no tags"', () => {
    expect(PersonalityTagsInputSchema.safeParse('').data).toEqual([]);
    expect(PersonalityTagsInputSchema.safeParse([]).data).toEqual([]);
  });

  it('accepts exactly the per-character cap', () => {
    const atCap = Array.from({ length: TAG_LIMITS.MAX_PER_CHARACTER }, (_, i) => `tag-${i}`);
    expect(PersonalityTagsInputSchema.safeParse(atCap).success).toBe(true);
  });

  it('rejects one tag over the per-character cap', () => {
    const overCap = Array.from({ length: TAG_LIMITS.MAX_PER_CHARACTER + 1 }, (_, i) => `tag-${i}`);
    expect(PersonalityTagsInputSchema.safeParse(overCap).success).toBe(false);
  });

  it('counts the cap AFTER dedupe, so duplicates do not consume slots', () => {
    const duplicated = Array.from(
      { length: TAG_LIMITS.MAX_PER_CHARACTER + 2 },
      () => 'the-same-tag'
    );
    const result = PersonalityTagsInputSchema.safeParse(duplicated);
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['the-same-tag']);
  });

  it('rejects the whole input when any single tag is invalid', () => {
    expect(PersonalityTagsInputSchema.safeParse('fantasy, bad!tag').success).toBe(false);
    expect(PersonalityTagsInputSchema.safeParse('fantasy, a').success).toBe(false);
  });

  it('dedupes hyphen-run and whitespace spellings of the same tag', () => {
    const result = PersonalityTagsInputSchema.safeParse('sci--fi, sci fi, Sci-Fi');
    expect(result.success).toBe(true);
    expect(result.data).toEqual(['sci-fi']);
  });

  describe('raw-size guards (bound the work before tokenizing)', () => {
    it('a maximal-but-valid comma string still passes', () => {
      const maximal = Array.from(
        { length: TAG_LIMITS.MAX_PER_CHARACTER },
        (_, i) =>
          // Distinct tags at exactly MAX_LENGTH: a numeric suffix over an 'x' run.
          `${'x'.repeat(TAG_LIMITS.MAX_LENGTH - 2)}${i.toString().padStart(2, '0')}`
      ).join(', ');
      expect(maximal.length).toBe(MAX_JOINED_TAGS_LENGTH);
      const result = PersonalityTagsInputSchema.safeParse(maximal);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(TAG_LIMITS.MAX_PER_CHARACTER);
    });

    it('a maximal-but-valid array still passes', () => {
      const maximal = Array.from(
        { length: TAG_LIMITS.MAX_PER_CHARACTER },
        (_, i) => `${'x'.repeat(TAG_LIMITS.MAX_LENGTH - 2)}${i.toString().padStart(2, '0')}`
      );
      const result = PersonalityTagsInputSchema.safeParse(maximal);
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(TAG_LIMITS.MAX_PER_CHARACTER);
    });

    // Each of these asserts the SPECIFIC raw ceiling that fired, not merely
    // that the input was rejected: the downstream tag rules would reject these
    // too, so a bare `success === false` passes with the guards deleted.
    it('rejects an oversized comma string AT the raw string ceiling', () => {
      const oversized = 'a,'.repeat(TAG_INPUT_LIMITS.MAX_RAW_STRING_LENGTH);
      const result = PersonalityTagsInputSchema.safeParse(oversized);
      expect(result.success).toBe(false);
      expect(result.error?.issues).toContainEqual(
        expect.objectContaining({
          code: 'too_big',
          origin: 'string',
          maximum: TAG_INPUT_LIMITS.MAX_RAW_STRING_LENGTH,
        })
      );
    });

    it('rejects an oversized array AT the raw element-count ceiling', () => {
      const oversized = Array.from(
        { length: TAG_INPUT_LIMITS.MAX_RAW_ARRAY_LENGTH + 1 },
        (_, i) => `tag-${i}`
      );
      const result = PersonalityTagsInputSchema.safeParse(oversized);
      expect(result.success).toBe(false);
      expect(result.error?.issues).toContainEqual(
        expect.objectContaining({
          code: 'too_big',
          origin: 'array',
          maximum: TAG_INPUT_LIMITS.MAX_RAW_ARRAY_LENGTH,
        })
      );
    });

    it('rejects a single oversized raw array element AT the element ceiling', () => {
      const oversized = ['x'.repeat(TAG_INPUT_LIMITS.MAX_RAW_ELEMENT_LENGTH + 1)];
      const result = PersonalityTagsInputSchema.safeParse(oversized);
      expect(result.success).toBe(false);
      expect(result.error?.issues).toContainEqual(
        expect.objectContaining({
          code: 'too_big',
          origin: 'string',
          maximum: TAG_INPUT_LIMITS.MAX_RAW_ELEMENT_LENGTH,
        })
      );
    });

    it('accepts a string exactly AT the raw ceiling (the bound is inclusive)', () => {
      // Padding a valid short tag out to exactly the ceiling with empty
      // tokens: the size guard passes, and the transform drops the empties.
      const padded = 'fantasy'.padEnd(TAG_INPUT_LIMITS.MAX_RAW_STRING_LENGTH, ',');
      expect(padded.length).toBe(TAG_INPUT_LIMITS.MAX_RAW_STRING_LENGTH);
      const result = PersonalityTagsInputSchema.safeParse(padded);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(['fantasy']);
    });

    it('the raw ceilings leave real headroom over the longest legitimate input', () => {
      // The guards bound WORK; the tag rules do the rejecting. A sloppy
      // over-long list must still reach the specific "too many tags" error.
      expect(TAG_INPUT_LIMITS.MAX_RAW_STRING_LENGTH).toBeGreaterThan(MAX_JOINED_TAGS_LENGTH * 4);
      expect(TAG_INPUT_LIMITS.MAX_RAW_ARRAY_LENGTH).toBeGreaterThan(
        TAG_LIMITS.MAX_PER_CHARACTER * 4
      );
      expect(TAG_INPUT_LIMITS.MAX_RAW_ELEMENT_LENGTH).toBeGreaterThan(TAG_LIMITS.MAX_LENGTH * 4);
    });

    it('an over-cap but under-ceiling list still gets the tag-count error, not a size error', () => {
      const overCap = Array.from(
        { length: TAG_LIMITS.MAX_PER_CHARACTER + 1 },
        (_, i) => `tag-${i}`
      );
      const result = PersonalityTagsInputSchema.safeParse(overCap);
      expect(result.success).toBe(false);
      expect(JSON.stringify(result.error?.issues)).toContain('at most');
    });
  });
});

describe('tags on the response schemas', () => {
  const fullPersonality = {
    id: '33333333-3333-5333-8333-333333333333',
    name: 'Test Character',
    slug: 'test-character',
    displayName: null,
    characterInfo: 'A test character',
    personalityTraits: 'Friendly',
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
    voiceEnabled: false,
    imageEnabled: false,
    ownerId: '44444444-4444-5444-8444-444444444444',
    hasAvatar: false,
    avatarUrl: null,
    hasVoiceReference: false,
    customFields: null,
    createdAt: '2025-01-15T12:00:00.000Z',
    updatedAt: '2025-01-20T15:30:00.000Z',
  };

  const summaryPersonality = {
    id: '33333333-3333-5333-8333-333333333333',
    name: 'TestCharacter',
    displayName: null,
    slug: 'test-character',
    isOwned: true,
    isPublic: false,
    ownerId: '44444444-4444-5444-8444-444444444444',
    ownerDiscordId: '123456789012345678',
    permissions: { canEdit: true, canDelete: true },
  };

  it('PersonalityFullSchema keeps tags through the strip-mode parse', () => {
    const result = PersonalityFullSchema.safeParse({
      ...fullPersonality,
      tags: ['fantasy', 'sci-fi'],
    });
    expect(result.success).toBe(true);
    expect(result.data?.tags).toEqual(['fantasy', 'sci-fi']);
  });

  it('PersonalityFullSchema defaults tags to [] for an older gateway response', () => {
    const result = PersonalityFullSchema.safeParse(fullPersonality);
    expect(result.success).toBe(true);
    expect(result.data?.tags).toEqual([]);
  });

  it('PersonalitySummarySchema keeps tags through the strip-mode parse', () => {
    const result = PersonalitySummarySchema.safeParse({
      ...summaryPersonality,
      tags: ['fantasy'],
    });
    expect(result.success).toBe(true);
    expect(result.data?.tags).toEqual(['fantasy']);
  });

  it('PersonalitySummarySchema defaults tags to [] for an older gateway response', () => {
    const result = PersonalitySummarySchema.safeParse(summaryPersonality);
    expect(result.success).toBe(true);
    expect(result.data?.tags).toEqual([]);
  });
});

describe('tags on the input schemas', () => {
  const minimalCreate = {
    name: 'Helen',
    slug: 'helen',
    characterInfo: 'A detective.',
    personalityTraits: 'Sharp.',
  };

  it('PersonalityCreateSchema normalizes a comma string into an array', () => {
    const result = PersonalityCreateSchema.safeParse({
      ...minimalCreate,
      tags: 'Mystery, Noir',
    });
    expect(result.success).toBe(true);
    expect(result.data?.tags).toEqual(['mystery', 'noir']);
  });

  it('PersonalityCreateSchema treats absent tags as undefined (not [])', () => {
    const result = PersonalityCreateSchema.safeParse(minimalCreate);
    expect(result.success).toBe(true);
    expect(result.data?.tags).toBeUndefined();
  });

  it('PersonalityUpdateSchema accepts a replayed tag ARRAY (the dashboard round-trip)', () => {
    const result = PersonalityUpdateSchema.safeParse({ tags: ['fantasy', 'sci-fi'] });
    expect(result.success).toBe(true);
    expect(result.data?.tags).toEqual(['fantasy', 'sci-fi']);
  });

  it('PersonalityUpdateSchema distinguishes absent (no change) from [] (clear)', () => {
    expect(PersonalityUpdateSchema.safeParse({}).data?.tags).toBeUndefined();
    expect(PersonalityUpdateSchema.safeParse({ tags: [] }).data?.tags).toEqual([]);
  });

  it('PersonalityUpdateSchema rejects an over-cap tag list', () => {
    const overCap = Array.from({ length: TAG_LIMITS.MAX_PER_CHARACTER + 1 }, (_, i) => `tag-${i}`);
    expect(PersonalityUpdateSchema.safeParse({ tags: overCap }).success).toBe(false);
  });
});

describe('PERSONALITY SELECT constants carry tags', () => {
  it('the detail select requests tags', () => {
    expect(PERSONALITY_DETAIL_SELECT.tags).toBe(true);
  });

  it('the list select requests tags', () => {
    expect(PERSONALITY_LIST_SELECT.tags).toBe(true);
  });
});
