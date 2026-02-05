/**
 * LLM Config API Contract Tests
 *
 * These tests verify the contract for LLM config (preset) API endpoints.
 * They ensure schemas match expected structure and catch breaking changes.
 */

import { describe, it, expect } from 'vitest';
import {
  LlmConfigSummarySchema,
  ListLlmConfigsResponseSchema,
  CreateLlmConfigResponseSchema,
  DeleteLlmConfigResponseSchema,
  ContextSettingsSchema,
  LlmConfigCreateSchema,
  LlmConfigUpdateSchema,
} from '../schemas/api/index.js';

describe('LLM Config API Contract Tests', () => {
  describe('LlmConfigSummarySchema', () => {
    const validConfig = {
      id: 'config-123',
      name: 'Default Config',
      description: 'A test configuration',
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      visionModel: 'openai/gpt-4o',
      isGlobal: true,
      isDefault: true,
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

    it('should validate config with null visionModel', () => {
      const config = { ...validConfig, visionModel: null };

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
            id: 'global-1',
            name: 'Default Preset',
            description: 'System default',
            provider: 'openrouter',
            model: 'openai/gpt-4o-mini',
            visionModel: null,
            isGlobal: true,
            isDefault: true,
            isOwned: false,
            permissions: { canEdit: false, canDelete: false },
          },
          {
            id: 'user-1',
            name: 'My Custom Preset',
            description: null,
            provider: 'openrouter',
            model: 'anthropic/claude-sonnet-4',
            visionModel: 'anthropic/claude-sonnet-4',
            isGlobal: false,
            isDefault: false,
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
          id: 'new-config-123',
          name: 'My New Preset',
          description: 'A custom preset',
          provider: 'openrouter',
          model: 'anthropic/claude-sonnet-4',
          visionModel: null,
          isGlobal: false,
          isDefault: false,
          isOwned: true,
          permissions: { canEdit: true, canDelete: true },
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
  // Input Schema Contract Tests (Phase 1 - Service Layer Consolidation)
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
        visionModel: 'anthropic/claude-sonnet-4',
        maxReferencedMessages: 10,
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
        visionModel: null,
        memoryScoreThreshold: null,
        memoryLimit: null,
        maxAge: null,
      };

      const result = LlmConfigCreateSchema.safeParse(inputWithNulls);
      expect(result.success).toBe(true);
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
        visionModel: 'claude-sonnet-4',
        maxReferencedMessages: 15,
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
        visionModel: null,
        memoryScoreThreshold: null,
        memoryLimit: null,
        maxAge: null,
      };

      const result = LlmConfigUpdateSchema.safeParse(clearingUpdate);
      expect(result.success).toBe(true);
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
});
