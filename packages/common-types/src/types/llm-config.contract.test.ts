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
