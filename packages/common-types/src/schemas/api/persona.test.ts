/**
 * Persona API Contract Tests
 *
 * Validates schemas for /user/persona endpoints.
 * Tests both response schemas and input schemas (create/update/override/settings).
 */

import { describe, it, expect } from 'vitest';
import { DISCORD_LIMITS } from '../../constants/discord.js';
import {
  PersonaDetailsSchema,
  PersonaSummarySchema,
  ListPersonasResponseSchema,
  GetPersonaResponseSchema,
  CreatePersonaResponseSchema,
  SetDefaultPersonaResponseSchema,
  OverrideInfoResponseSchema,
  SetOverrideResponseSchema,
  ClearOverrideResponseSchema,
  CreateOverrideResponseSchema,
  PersonaCreateSchema,
  PersonaUpdateSchema,
  SetPersonaOverrideSchema,
} from './persona.js';

/** Helper to create valid persona details */
function createValidPersonaDetails(overrides = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Default',
    preferredName: 'Alex',
    description: 'My main persona',
    pronouns: 'they/them',
    content: 'Custom persona content',
    isDefault: true,
    createdAt: '2025-01-15T12:00:00.000Z',
    updatedAt: '2025-01-20T15:30:00.000Z',
    ...overrides,
  };
}

/** Helper to create valid personality ref */
function createPersonalityRef(overrides = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440001',
    name: 'Lilith',
    displayName: 'Lilith the Sarcastic',
    ...overrides,
  };
}

/** Helper to create valid persona ref */
function createPersonaRef(overrides = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    name: 'Default',
    preferredName: 'Alex',
    ...overrides,
  };
}

describe('Persona API Contract Tests', () => {
  describe('PersonaDetailsSchema', () => {
    it('should accept valid persona details', () => {
      const data = createValidPersonaDetails();
      const result = PersonaDetailsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept persona with all nullable fields as null', () => {
      const data = createValidPersonaDetails({
        preferredName: null,
        description: null,
        pronouns: null,
        content: null,
      });
      const result = PersonaDetailsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID for id', () => {
      const data = createValidPersonaDetails({ id: 'not-a-uuid' });
      const result = PersonaDetailsSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const result = PersonaDetailsSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('PersonaSummarySchema', () => {
    it('should accept valid persona summary', () => {
      const data = createValidPersonaDetails();
      const result = PersonaSummarySchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept non-default persona', () => {
      const data = createValidPersonaDetails({ isDefault: false });
      const result = PersonaSummarySchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('ListPersonasResponseSchema', () => {
    it('should accept response with personas', () => {
      const data = {
        personas: [
          createValidPersonaDetails(),
          createValidPersonaDetails({
            id: '550e8400-e29b-41d4-a716-446655440002',
            name: 'Alt',
            isDefault: false,
          }),
        ],
      };
      const result = ListPersonasResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept empty personas array', () => {
      const data = { personas: [] };
      const result = ListPersonasResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing personas field', () => {
      const result = ListPersonasResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('GetPersonaResponseSchema', () => {
    it('should accept valid get response', () => {
      const data = { persona: createValidPersonaDetails() };
      const result = GetPersonaResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing persona field', () => {
      const result = GetPersonaResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('CreatePersonaResponseSchema', () => {
    it('should accept valid create response', () => {
      const data = {
        success: true as const,
        persona: createValidPersonaDetails(),
        setAsDefault: true,
      };
      const result = CreatePersonaResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept create response with setAsDefault=false', () => {
      const data = {
        success: true as const,
        persona: createValidPersonaDetails({ isDefault: false }),
        setAsDefault: false,
      };
      const result = CreatePersonaResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject success=false', () => {
      const data = {
        success: false,
        persona: createValidPersonaDetails(),
        setAsDefault: true,
      };
      const result = CreatePersonaResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('SetDefaultPersonaResponseSchema', () => {
    it('should accept valid set default response', () => {
      const data = {
        success: true as const,
        persona: createPersonaRef(),
        alreadyDefault: false,
      };
      const result = SetDefaultPersonaResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept response when already default', () => {
      const data = {
        success: true as const,
        persona: createPersonaRef(),
        alreadyDefault: true,
      };
      const result = SetDefaultPersonaResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept persona ref with null preferredName', () => {
      const data = {
        success: true as const,
        persona: createPersonaRef({ preferredName: null }),
        alreadyDefault: false,
      };
      const result = SetDefaultPersonaResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('OverrideInfoResponseSchema', () => {
    it('should accept valid override info', () => {
      const data = { personality: createPersonalityRef() };
      const result = OverrideInfoResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept personality with null displayName', () => {
      const data = { personality: createPersonalityRef({ displayName: null }) };
      const result = OverrideInfoResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing personality', () => {
      const result = OverrideInfoResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('SetOverrideResponseSchema', () => {
    it('should accept valid set override response', () => {
      const data = {
        success: true as const,
        personality: createPersonalityRef(),
        persona: createPersonaRef(),
      };
      const result = SetOverrideResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing persona', () => {
      const data = {
        success: true as const,
        personality: createPersonalityRef(),
      };
      const result = SetOverrideResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('ClearOverrideResponseSchema', () => {
    it('should accept response with override cleared', () => {
      const data = {
        success: true as const,
        personality: createPersonalityRef(),
        hadOverride: true,
      };
      const result = ClearOverrideResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept response when no override existed', () => {
      const data = {
        success: true as const,
        personality: createPersonalityRef(),
        hadOverride: false,
      };
      const result = ClearOverrideResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('CreateOverrideResponseSchema', () => {
    it('should accept valid create override response', () => {
      const data = {
        success: true as const,
        persona: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Override Persona',
          preferredName: null,
          description: 'Created for override',
          pronouns: null,
          content: null,
        },
        personality: {
          name: 'Lilith',
          displayName: 'Lilith the Sarcastic',
        },
      };
      const result = CreateOverrideResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept response with null personality displayName', () => {
      const data = {
        success: true as const,
        persona: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          name: 'Override Persona',
          preferredName: 'Alex',
          description: null,
          pronouns: null,
          content: null,
        },
        personality: {
          name: 'Lilith',
          displayName: null,
        },
      };
      const result = CreateOverrideResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing persona', () => {
      const data = {
        success: true as const,
        personality: { name: 'Lilith', displayName: null },
      };
      const result = CreateOverrideResponseSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  // ================================================================
  // Input Schema Tests
  // ================================================================

  describe('PersonaCreateSchema', () => {
    it('should accept valid full input', () => {
      const data = {
        name: 'My Persona',
        content: 'Some persona content',
        preferredName: 'Alex',
        description: 'A description',
        pronouns: 'they/them',
      };
      const result = PersonaCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept minimal input (name + content only)', () => {
      const data = { name: 'Minimal', content: 'Content here' };
      const result = PersonaCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept nullable fields as null', () => {
      const data = {
        name: 'Test',
        content: 'Content',
        preferredName: null,
        description: null,
        pronouns: null,
      };
      const result = PersonaCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should transform empty string nullable fields to null', () => {
      const data = {
        name: 'Test',
        content: 'Content',
        preferredName: '',
        description: '   ',
        pronouns: '',
      };
      const result = PersonaCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preferredName).toBeNull();
        expect(result.data.description).toBeNull();
        expect(result.data.pronouns).toBeNull();
      }
    });

    it('should reject missing name', () => {
      const data = { content: 'Content' };
      const result = PersonaCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const data = { name: '', content: 'Content' };
      const result = PersonaCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject name over 255 characters', () => {
      const data = { name: 'a'.repeat(256), content: 'Content' };
      const result = PersonaCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing content', () => {
      const data = { name: 'Test' };
      const result = PersonaCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject empty content', () => {
      const data = { name: 'Test', content: '' };
      const result = PersonaCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject content over MODAL_INPUT_MAX_LENGTH', () => {
      const data = {
        name: 'Test',
        content: 'a'.repeat(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH + 1),
      };
      const result = PersonaCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('PersonaUpdateSchema', () => {
    it('should accept empty object (no fields to update)', () => {
      const result = PersonaUpdateSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should accept partial update with name only', () => {
      const data = { name: 'New Name' };
      const result = PersonaUpdateSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe('New Name');
      }
    });

    it('should transform empty required fields to undefined (preserve existing)', () => {
      const data = { name: '', content: '   ' };
      const result = PersonaUpdateSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBeUndefined();
        expect(result.data.content).toBeUndefined();
      }
    });

    it('should transform empty nullable fields to null (clear value)', () => {
      const data = { preferredName: '', description: '  ', pronouns: '' };
      const result = PersonaUpdateSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.preferredName).toBeNull();
        expect(result.data.description).toBeNull();
        expect(result.data.pronouns).toBeNull();
      }
    });

    it('should reject name over 255 characters', () => {
      const data = { name: 'a'.repeat(256) };
      const result = PersonaUpdateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject content over MODAL_INPUT_MAX_LENGTH', () => {
      const data = { content: 'a'.repeat(DISCORD_LIMITS.MODAL_INPUT_MAX_LENGTH + 1) };
      const result = PersonaUpdateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('SetPersonaOverrideSchema', () => {
    it('should accept valid UUID', () => {
      const data = { personaId: '550e8400-e29b-41d4-a716-446655440000' };
      const result = SetPersonaOverrideSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject non-RFC4122 UUID format', () => {
      const data = { personaId: 'f6a7b8c9-d0e1-2345-f012-456789012345' };
      const result = SetPersonaOverrideSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject non-UUID string', () => {
      const data = { personaId: 'not-a-uuid' };
      const result = SetPersonaOverrideSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject empty string', () => {
      const data = { personaId: '' };
      const result = SetPersonaOverrideSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject missing personaId', () => {
      const result = SetPersonaOverrideSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
