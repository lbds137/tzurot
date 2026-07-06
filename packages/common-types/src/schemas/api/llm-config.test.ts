/**
 * LLM Config API Contract Tests
 *
 * These tests verify the contract for LLM config (preset) API endpoints.
 * They ensure schemas match expected structure and catch breaking changes.
 */

import { describe, it, expect } from 'vitest';
import {
  LlmConfigSummarySchema,
  LlmConfigDetailSchema,
  ListLlmConfigsResponseSchema,
  CreateLlmConfigResponseSchema,
  DeleteLlmConfigResponseSchema,
  GetLlmConfigResponseSchema,
  UpdateLlmConfigResponseSchema,
  SetDefaultLlmConfigResponseSchema,
  ResolveLlmConfigInputSchema,
  ResolveLlmConfigResponseSchema,
  ContextSettingsSchema,
  LlmConfigCreateSchema,
  LlmConfigUpdateSchema,
} from './llm-config.js';

describe('LLM Config API Contract Tests', () => {
  describe('LlmConfigSummarySchema', () => {
    const validConfig = {
      // Fixed RFC-4122-valid UUID: the schema rejects non-UUID ids at the
      // response boundary (added in PR #827 follow-up). Previously 'config-123'.
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Default Config',
      description: 'A test configuration',
      model: 'openai/gpt-4o-mini',
      provider: 'openrouter',
      supportsVision: false,

      isGlobal: true,
      isDefault: true,
      isFreeDefault: false,
      isOwned: false,
      permissions: { canEdit: false, canDelete: false },
    };

    it('should validate a complete config summary', () => {
      const result = LlmConfigSummarySchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should validate config with null description', () => {
      const config = { ...validConfig, description: null };

      const result = LlmConfigSummarySchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('should validate user-owned config', () => {
      const userConfig = {
        ...validConfig,
        isGlobal: false,
        isDefault: false,
        isOwned: true,
        permissions: { canEdit: true, canDelete: true },
      };

      const result = LlmConfigSummarySchema.safeParse(userConfig);
      expect(result.success).toBe(true);
    });

    it('should validate global config with admin permissions', () => {
      // Bot owner viewing a global config
      const globalConfig = {
        ...validConfig,
        isGlobal: true,
        isOwned: false, // Truthful: bot owner didn't create system presets
        permissions: { canEdit: true, canDelete: true }, // But can edit them
      };

      const result = LlmConfigSummarySchema.safeParse(globalConfig);
      expect(result.success).toBe(true);
    });

    it('should reject missing permissions', () => {
      const { permissions: _permissions, ...configWithoutPermissions } = validConfig;

      const result = LlmConfigSummarySchema.safeParse(configWithoutPermissions);
      expect(result.success).toBe(false);
    });

    it('should reject missing required fields', () => {
      const incompleteConfig = {
        id: validConfig.id,
        name: validConfig.name,
        // Missing: description, provider, model, etc.
      };

      const result = LlmConfigSummarySchema.safeParse(incompleteConfig);
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean isGlobal', () => {
      const invalidConfig = { ...validConfig, isGlobal: 'true' };

      const result = LlmConfigSummarySchema.safeParse(invalidConfig);
      expect(result.success).toBe(false);
    });

    it('should reject a non-RFC-4122 UUID id (beta.100 preset blocker)', () => {
      // The 4 production configs that caused the preset blocker had ids
      // where the 13th hex digit (variant nibble) was outside 8/9/a/b.
      // Postgres's `uuid` type accepted them; Zod's `.uuid()` rejects
      // them. This schema is now strict so the gateway refuses to serve
      // such configs rather than letting them reach autocomplete and
      // fail opaquely at the SetDefaultConfigSchema write boundary.
      const nonRfcConfig = {
        ...validConfig,
        id: '2cf9a6ea-7b1d-2fc3-f4de-0a9c2f3b7e1f', // variant='f' — invalid RFC 4122
      };

      const result = LlmConfigSummarySchema.safeParse(nonRfcConfig);
      expect(result.success).toBe(false);
    });
  });

  describe('LlmConfigDetailSchema', () => {
    const validDetail = {
      id: '00000000-0000-4000-8000-000000000009',
      name: 'Detail Config',
      description: null,
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',

      isGlobal: true,
      isOwned: false,
      permissions: { canEdit: false, canDelete: false },
      contextWindowTokens: 8000,
      params: { temperature: 0.7, reasoning: { effort: 'high' } },
    };

    it('validates a full detail config', () => {
      expect(LlmConfigDetailSchema.safeParse(validDetail).success).toBe(true);
    });

    it('omits isDefault/isFreeDefault from the detail shape (pointer-relationship, not entity attr)', () => {
      // Default-ness lives on the AdminSettings pointers (carried on the LIST
      // summary for badges), never on the canonical detail. Pins the omit so a
      // future accidental re-add is caught. See S4a.
      const parsed = LlmConfigDetailSchema.parse({
        ...validDetail,
        isDefault: true,
        isFreeDefault: true,
      });
      expect('isDefault' in parsed).toBe(false);
      expect('isFreeDefault' in parsed).toBe(false);
    });

    it('allows optional modelContextLength / contextWindowCap', () => {
      const withModelContext = {
        ...validDetail,
        modelContextLength: 128000,
        contextWindowCap: 64000,
      };
      expect(LlmConfigDetailSchema.safeParse(withModelContext).success).toBe(true);
    });

    it('requires contextWindowTokens', () => {
      const { contextWindowTokens: _c, ...withoutCwt } = validDetail;
      expect(LlmConfigDetailSchema.safeParse(withoutCwt).success).toBe(false);
    });

    it('requires params', () => {
      const { params: _p, ...withoutParams } = validDetail;
      expect(LlmConfigDetailSchema.safeParse(withoutParams).success).toBe(false);
    });

    it('accepts empty params object (gateway emits {} for no advanced params)', () => {
      expect(LlmConfigDetailSchema.safeParse({ ...validDetail, params: {} }).success).toBe(true);
    });

    it('allows and preserves the optional requiresZaiKey flag', () => {
      // The gateway sets this for the dashboard's "requires z.ai key" badge; it
      // must be part of the contract so client-side parsing doesn't strip it.
      const parsed = LlmConfigDetailSchema.safeParse({ ...validDetail, requiresZaiKey: true });
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.requiresZaiKey).toBe(true);
    });
  });

  describe('ListLlmConfigsResponseSchema', () => {
    it('should validate empty configs list', () => {
      const response = { configs: [] };

      const result = ListLlmConfigsResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should validate list with mixed global and user configs', () => {
      const response = {
        configs: [
          {
            id: '00000000-0000-4000-8000-000000000002',
            name: 'Default Preset',
            description: 'System default',
            model: 'openai/gpt-4o-mini',
            provider: 'openrouter',
            supportsVision: false,

            isGlobal: true,
            isDefault: true,
            isFreeDefault: false,
            isOwned: false,
            permissions: { canEdit: false, canDelete: false },
          },
          {
            id: '00000000-0000-4000-8000-000000000003',
            name: 'My Custom Preset',
            description: null,
            model: 'anthropic/claude-sonnet-4',
            provider: 'openrouter',
            supportsVision: true,

            isGlobal: false,
            isDefault: false,
            isFreeDefault: false,
            isOwned: true,
            permissions: { canEdit: true, canDelete: true },
          },
        ],
      };

      const result = ListLlmConfigsResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should reject response without configs array', () => {
      const invalidResponse = {};

      const result = ListLlmConfigsResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('CreateLlmConfigResponseSchema', () => {
    it('should validate successful create response', () => {
      const response = {
        config: {
          id: '00000000-0000-4000-8000-000000000004',
          name: 'My New Preset',
          description: 'A custom preset',
          model: 'anthropic/claude-sonnet-4',
          provider: 'openrouter',

          isGlobal: false,
          isDefault: false,
          isFreeDefault: false,
          isOwned: true,
          permissions: { canEdit: true, canDelete: true },
          // Detail shape (POST returns the full preset)
          contextWindowTokens: 8000,
          params: { temperature: 0.7 },
        },
      };

      const result = CreateLlmConfigResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should reject response without config', () => {
      const invalidResponse = { success: true };

      const result = CreateLlmConfigResponseSchema.safeParse(invalidResponse);
      expect(result.success).toBe(false);
    });
  });

  describe('DeleteLlmConfigResponseSchema', () => {
    it('should validate successful delete response', () => {
      const response = { deleted: true };

      const result = DeleteLlmConfigResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should reject deleted: false', () => {
      // The schema uses z.literal(true), so false should fail
      const response = { deleted: false };

      const result = DeleteLlmConfigResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });

    it('should reject missing deleted field', () => {
      const response = { success: true };

      const result = DeleteLlmConfigResponseSchema.safeParse(response);
      expect(result.success).toBe(false);
    });
  });

  // ==========================================================================
  // Input Schema Contract Tests (Service Layer Consolidation)
  // ==========================================================================

  describe('ContextSettingsSchema', () => {
    it('should validate complete context settings', () => {
      const settings = {
        maxMessages: 50,
        maxAge: 3600, // 1 hour
        maxImages: 10,
      };

      const result = ContextSettingsSchema.safeParse(settings);
      expect(result.success).toBe(true);
    });

    it('should validate empty object (all fields optional)', () => {
      const result = ContextSettingsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should validate maxAge as null (no time limit)', () => {
      const settings = { maxAge: null };

      const result = ContextSettingsSchema.safeParse(settings);
      expect(result.success).toBe(true);
    });

    it('should validate maxImages as 0 (disables image processing)', () => {
      const settings = { maxImages: 0 };

      const result = ContextSettingsSchema.safeParse(settings);
      expect(result.success).toBe(true);
    });

    it('should reject maxMessages below minimum (1)', () => {
      const settings = { maxMessages: 0 };

      const result = ContextSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });

    it('should reject maxMessages above maximum (100)', () => {
      const settings = { maxMessages: 101 };

      const result = ContextSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });

    it('should reject maxAge below minimum (1 second)', () => {
      const settings = { maxAge: 0 };

      const result = ContextSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });

    it('should reject maxAge above maximum (30 days)', () => {
      const settings = { maxAge: 2592001 }; // 30 days + 1 second

      const result = ContextSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });

    it('should reject maxImages below minimum (0)', () => {
      const settings = { maxImages: -1 };

      const result = ContextSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });

    it('should reject maxImages above maximum (20)', () => {
      const settings = { maxImages: 21 };

      const result = ContextSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });

    it('should reject non-integer values', () => {
      const settings = { maxMessages: 50.5 };

      const result = ContextSettingsSchema.safeParse(settings);
      expect(result.success).toBe(false);
    });
  });

  describe('LlmConfigCreateSchema', () => {
    const validCreateInput = {
      name: 'My Custom Preset',
      model: 'anthropic/claude-sonnet-4',
      provider: 'openrouter',
    };

    it('should validate minimal create input (only required fields)', () => {
      const result = LlmConfigCreateSchema.safeParse(validCreateInput);
      expect(result.success).toBe(true);
    });

    it('should validate complete create input with all optional fields', () => {
      const completeInput = {
        ...validCreateInput,
        description: 'A detailed description',
        provider: 'openrouter',
        advancedParameters: { temperature: 0.7, maxTokens: 2000 },
        memoryScoreThreshold: 0.75,
        memoryLimit: 50,
        contextWindowTokens: 100000,
        maxMessages: 50,
        maxAge: 3600,
        maxImages: 10,
      };

      const result = LlmConfigCreateSchema.safeParse(completeInput);
      expect(result.success).toBe(true);
    });

    it('should validate create input with null optional fields', () => {
      const inputWithNulls = {
        ...validCreateInput,
        description: null,
        maxAge: null,
      };

      const result = LlmConfigCreateSchema.safeParse(inputWithNulls);
      expect(result.success).toBe(true);
    });

    it('should reject null for memoryScoreThreshold / memoryLimit (NOT NULL with schema default)', () => {
      // Schema has these fields NOT NULL with @default(0.5) / @default(20).
      // Callers omit to get the default; null is not a meaningful input value.
      const inputWithNullMemory = {
        ...validCreateInput,
        memoryScoreThreshold: null,
      };
      expect(LlmConfigCreateSchema.safeParse(inputWithNullMemory).success).toBe(false);

      const inputWithNullLimit = {
        ...validCreateInput,
        memoryLimit: null,
      };
      expect(LlmConfigCreateSchema.safeParse(inputWithNullLimit).success).toBe(false);
    });

    it('should reject missing name', () => {
      const { name: _name, ...inputWithoutName } = validCreateInput;

      const result = LlmConfigCreateSchema.safeParse(inputWithoutName);
      expect(result.success).toBe(false);
    });

    it('should reject empty name', () => {
      const input = { ...validCreateInput, name: '' };

      const result = LlmConfigCreateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject name exceeding max length (100)', () => {
      const input = { ...validCreateInput, name: 'a'.repeat(101) };

      const result = LlmConfigCreateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject missing model', () => {
      const { model: _model, ...inputWithoutModel } = validCreateInput;

      const result = LlmConfigCreateSchema.safeParse(inputWithoutModel);
      expect(result.success).toBe(false);
    });

    it('should reject empty model', () => {
      const input = { ...validCreateInput, model: '' };

      const result = LlmConfigCreateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should reject memoryScoreThreshold outside 0-1 range', () => {
      const inputAbove = { ...validCreateInput, memoryScoreThreshold: 1.5 };
      const inputBelow = { ...validCreateInput, memoryScoreThreshold: -0.1 };

      expect(LlmConfigCreateSchema.safeParse(inputAbove).success).toBe(false);
      expect(LlmConfigCreateSchema.safeParse(inputBelow).success).toBe(false);
    });

    it('should reject non-positive memoryLimit', () => {
      const inputZero = { ...validCreateInput, memoryLimit: 0 };
      const inputNegative = { ...validCreateInput, memoryLimit: -1 };

      expect(LlmConfigCreateSchema.safeParse(inputZero).success).toBe(false);
      expect(LlmConfigCreateSchema.safeParse(inputNegative).success).toBe(false);
    });

    it('should reject contextWindowTokens below minimum (1000)', () => {
      const input = { ...validCreateInput, contextWindowTokens: 999 };

      const result = LlmConfigCreateSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it('should validate context settings through spread', () => {
      // Verify that ContextSettingsSchema fields are included
      const input = {
        ...validCreateInput,
        maxMessages: 100, // max allowed
        maxAge: 2592000, // 30 days max
        maxImages: 20, // max allowed
      };

      const result = LlmConfigCreateSchema.safeParse(input);
      expect(result.success).toBe(true);
    });
  });

  describe('LlmConfigUpdateSchema', () => {
    it('should validate empty update (no fields changed)', () => {
      const result = LlmConfigUpdateSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it('should validate partial update with single field', () => {
      const updates = [
        { name: 'New Name' },
        { model: 'new-model' },
        { description: 'New description' },
        { isGlobal: true },
        { memoryScoreThreshold: 0.8 },
        { memoryLimit: 100 },
        { contextWindowTokens: 50000 },
        { maxMessages: 25 },
        { maxAge: 7200 },
        { maxImages: 5 },
      ];

      for (const update of updates) {
        const result = LlmConfigUpdateSchema.safeParse(update);
        expect(result.success).toBe(true);
      }
    });

    it('should validate complete update with all fields', () => {
      const completeUpdate = {
        name: 'Updated Preset',
        description: 'Updated description',
        provider: 'anthropic',
        model: 'claude-sonnet-4',
        advancedParameters: { temperature: 0.5 },
        memoryScoreThreshold: 0.9,
        memoryLimit: 75,
        contextWindowTokens: 200000,
        maxMessages: 75,
        maxAge: 86400,
        maxImages: 15,
        isGlobal: false,
      };

      const result = LlmConfigUpdateSchema.safeParse(completeUpdate);
      expect(result.success).toBe(true);
    });

    it('should validate clearing nullable fields with null', () => {
      const clearingUpdate = {
        description: null,
        maxAge: null,
      };

      const result = LlmConfigUpdateSchema.safeParse(clearingUpdate);
      expect(result.success).toBe(true);
    });

    it('should reject null for memoryScoreThreshold / memoryLimit on update (NOT NULL with schema default)', () => {
      expect(LlmConfigUpdateSchema.safeParse({ memoryScoreThreshold: null }).success).toBe(false);
      expect(LlmConfigUpdateSchema.safeParse({ memoryLimit: null }).success).toBe(false);
    });

    it('should reject invalid field values (same validation as create)', () => {
      const invalidUpdates = [
        { memoryScoreThreshold: 1.5 }, // above max
        { memoryLimit: 0 }, // not positive
        { contextWindowTokens: 500 }, // below min
        { maxMessages: 101 }, // above max
        { maxImages: -1 }, // below min
      ];

      for (const update of invalidUpdates) {
        const result = LlmConfigUpdateSchema.safeParse(update);
        expect(result.success).toBe(false);
      }
    });

    it('should validate isGlobal toggle (user sharing preset)', () => {
      const toggleGlobal = { isGlobal: true };

      const result = LlmConfigUpdateSchema.safeParse(toggleGlobal);
      expect(result.success).toBe(true);
    });
  });

  describe('Contract Documentation', () => {
    it('should document the preset permissions model', () => {
      // This test serves as documentation:
      //
      // LLM CONFIG (PRESET) PERMISSIONS:
      //
      // Global presets (system defaults):
      // - isGlobal: true
      // - isOwned: false (no user created them)
      // - Regular users: canEdit: false, canDelete: false
      // - Bot owner: canEdit: true, canDelete: true
      //
      // User presets:
      // - isGlobal: false
      // - isOwned: true (user created it)
      // - Owner: canEdit: true, canDelete: true
      // - Others: canEdit: false, canDelete: false (not visible)
      // - Bot owner: canEdit: true, canDelete: true
      //
      // The permissions field is computed server-side using:
      // computeLlmConfigPermissions(config, userId, discordUserId)

      expect(true).toBe(true);
    });
  });

  describe('GetLlmConfigResponseSchema', () => {
    // GET-by-id returns the DETAIL shape: the summary fields plus the
    // model-coupled context-window fields and the `params` object.
    const validConfig = {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'cfg',
      description: null,
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',

      isGlobal: true,
      isDefault: false,
      isFreeDefault: false,
      isOwned: false,
      permissions: { canEdit: false, canDelete: false },
      contextWindowTokens: 8000,
      params: {},
    };

    it('accepts a single-config wrapper', () => {
      expect(GetLlmConfigResponseSchema.safeParse({ config: validConfig }).success).toBe(true);
    });

    it('rejects a summary-only config (missing detail fields)', () => {
      const { contextWindowTokens: _c, params: _p, ...summaryOnly } = validConfig;
      expect(GetLlmConfigResponseSchema.safeParse({ config: summaryOnly }).success).toBe(false);
    });

    it('rejects missing config field', () => {
      expect(GetLlmConfigResponseSchema.safeParse({}).success).toBe(false);
    });
  });

  describe('UpdateLlmConfigResponseSchema', () => {
    it('mirrors GetLlmConfigResponseSchema (same detail { config } shape)', () => {
      const validConfig = {
        id: '00000000-0000-4000-8000-000000000001',
        name: 'cfg',
        description: null,
        provider: 'openrouter',
        model: 'openai/gpt-4o-mini',

        isGlobal: true,
        isDefault: false,
        isFreeDefault: false,
        isOwned: false,
        permissions: { canEdit: false, canDelete: false },
        contextWindowTokens: 8000,
        params: {},
      };
      expect(UpdateLlmConfigResponseSchema.safeParse({ config: validConfig }).success).toBe(true);
    });
  });

  describe('SetDefaultLlmConfigResponseSchema', () => {
    it('accepts { success, configName }', () => {
      expect(
        SetDefaultLlmConfigResponseSchema.safeParse({
          success: true,
          configName: 'paid-default',
        }).success
      ).toBe(true);
    });

    it('rejects missing configName', () => {
      expect(SetDefaultLlmConfigResponseSchema.safeParse({ success: true }).success).toBe(false);
    });
  });

  describe('ResolveLlmConfigInputSchema', () => {
    const validPersonalityConfig = { id: 'p1-uuid', name: 'Lilith', model: 'gpt-4' };

    it('accepts minimal body with required personalityConfig fields', () => {
      const body = { personalityId: 'p1', personalityConfig: validPersonalityConfig };
      expect(ResolveLlmConfigInputSchema.safeParse(body).success).toBe(true);
    });

    it('accepts personalityConfig with extra passthrough fields (full LoadedPersonality)', () => {
      const body = {
        personalityId: 'p1',
        personalityConfig: {
          ...validPersonalityConfig,
          maxMessages: 50,
          maxImages: 10,
          customField: 'arbitrary',
        },
      };
      expect(ResolveLlmConfigInputSchema.safeParse(body).success).toBe(true);
    });

    it('accepts optional channelId', () => {
      const body = {
        personalityId: 'p1',
        personalityConfig: validPersonalityConfig,
        channelId: '123',
      };
      expect(ResolveLlmConfigInputSchema.safeParse(body).success).toBe(true);
    });

    it('rejects empty personalityId', () => {
      const body = { personalityId: '', personalityConfig: validPersonalityConfig };
      expect(ResolveLlmConfigInputSchema.safeParse(body).success).toBe(false);
    });

    it('rejects missing personalityConfig', () => {
      const body = { personalityId: 'p1' };
      expect(ResolveLlmConfigInputSchema.safeParse(body).success).toBe(false);
    });

    it('rejects personalityConfig missing required fields (id, name, model)', () => {
      const body = { personalityId: 'p1', personalityConfig: { model: 'gpt-4' } };
      expect(ResolveLlmConfigInputSchema.safeParse(body).success).toBe(false);
    });
  });

  describe('ResolveLlmConfigResponseSchema', () => {
    it('accepts minimal response with config.model and source', () => {
      const data = { config: { model: 'claude-sonnet-4' }, source: 'user-default' };
      expect(ResolveLlmConfigResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts config with extra passthrough fields', () => {
      const data = {
        config: {
          model: 'gpt-4',
          maxMessages: 20,
          maxAge: 3600,
          maxImages: 5,
          temperature: 0.7, // extra ConvertedLlmParams field
        },
        source: 'personality',
        overrides: { maxMessages: 20 },
      };
      expect(ResolveLlmConfigResponseSchema.safeParse(data).success).toBe(true);
    });

    it('accepts null maxAge', () => {
      const data = {
        config: { model: 'm', maxMessages: 10, maxAge: null, maxImages: 0 },
        source: 'personality',
      };
      expect(ResolveLlmConfigResponseSchema.safeParse(data).success).toBe(true);
    });

    it('rejects missing config.model', () => {
      const data = { config: {}, source: 'personality' };
      expect(ResolveLlmConfigResponseSchema.safeParse(data).success).toBe(false);
    });

    it('rejects missing source', () => {
      const data = { config: { model: 'm' } };
      expect(ResolveLlmConfigResponseSchema.safeParse(data).success).toBe(false);
    });
  });
});
