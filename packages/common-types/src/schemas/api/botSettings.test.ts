/**
 * Tests for botSettings.ts Zod schemas
 */

import { describe, it, expect } from 'vitest';
import {
  BotSettingSchema,
  ListBotSettingsResponseSchema,
  GetBotSettingResponseSchema,
  UpdateBotSettingRequestSchema,
  UpdateBotSettingResponseSchema,
  BotSettingKeys,
  parseBooleanSetting,
} from './botSettings.js';

describe('botSettings schemas', () => {
  describe('BotSettingSchema', () => {
    it('should validate a complete bot setting', () => {
      const validSetting = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        key: 'extended_context_default',
        value: 'true',
        description: 'Default extended context setting',
        updatedBy: '550e8400-e29b-41d4-a716-446655440001',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-02T00:00:00.000Z',
      };

      const result = BotSettingSchema.safeParse(validSetting);
      expect(result.success).toBe(true);
    });

    it('should allow null description and updatedBy', () => {
      const validSetting = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        key: 'test_key',
        value: 'test_value',
        description: null,
        updatedBy: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };

      const result = BotSettingSchema.safeParse(validSetting);
      expect(result.success).toBe(true);
    });

    it('should reject empty key', () => {
      const invalidSetting = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        key: '',
        value: 'test_value',
        description: null,
        updatedBy: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };

      const result = BotSettingSchema.safeParse(invalidSetting);
      expect(result.success).toBe(false);
    });

    it('should reject key longer than 100 characters', () => {
      const invalidSetting = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        key: 'a'.repeat(101),
        value: 'test_value',
        description: null,
        updatedBy: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };

      const result = BotSettingSchema.safeParse(invalidSetting);
      expect(result.success).toBe(false);
    });

    it('should reject invalid UUID for id', () => {
      const invalidSetting = {
        id: 'not-a-uuid',
        key: 'test_key',
        value: 'test_value',
        description: null,
        updatedBy: null,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };

      const result = BotSettingSchema.safeParse(invalidSetting);
      expect(result.success).toBe(false);
    });
  });

  describe('ListBotSettingsResponseSchema', () => {
    it('should validate response with empty settings array', () => {
      const result = ListBotSettingsResponseSchema.safeParse({ settings: [] });
      expect(result.success).toBe(true);
    });

    it('should validate response with multiple settings', () => {
      const response = {
        settings: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            key: 'key1',
            value: 'value1',
            description: null,
            updatedBy: null,
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            key: 'key2',
            value: 'value2',
            description: 'Description',
            updatedBy: '550e8400-e29b-41d4-a716-446655440002',
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      };

      const result = ListBotSettingsResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });

  describe('GetBotSettingResponseSchema', () => {
    it('should validate response when setting found', () => {
      const response = {
        found: true,
        setting: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          key: 'test_key',
          value: 'test_value',
          description: null,
          updatedBy: null,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
      };

      const result = GetBotSettingResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should validate response when setting not found', () => {
      const response = {
        found: false,
      };

      const result = GetBotSettingResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });

  describe('UpdateBotSettingRequestSchema', () => {
    it('should validate request with value only', () => {
      const request = { value: 'true' };
      const result = UpdateBotSettingRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it('should validate request with value and description', () => {
      const request = { value: 'false', description: 'Updated description' };
      const result = UpdateBotSettingRequestSchema.safeParse(request);
      expect(result.success).toBe(true);
    });

    it('should reject request without value', () => {
      const request = { description: 'Missing value' };
      const result = UpdateBotSettingRequestSchema.safeParse(request);
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateBotSettingResponseSchema', () => {
    it('should validate response with created=true', () => {
      const response = {
        setting: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          key: 'new_key',
          value: 'new_value',
          description: null,
          updatedBy: null,
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-01T00:00:00.000Z',
        },
        created: true,
      };

      const result = UpdateBotSettingResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });

    it('should validate response with created=false', () => {
      const response = {
        setting: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          key: 'existing_key',
          value: 'updated_value',
          description: 'Updated',
          updatedBy: '550e8400-e29b-41d4-a716-446655440001',
          createdAt: '2025-01-01T00:00:00.000Z',
          updatedAt: '2025-01-02T00:00:00.000Z',
        },
        created: false,
      };

      const result = UpdateBotSettingResponseSchema.safeParse(response);
      expect(result.success).toBe(true);
    });
  });

  describe('BotSettingKeys', () => {
    it('should have EXTENDED_CONTEXT_DEFAULT key', () => {
      expect(BotSettingKeys.EXTENDED_CONTEXT_DEFAULT).toBe('extended_context_default');
    });
  });

  describe('parseBooleanSetting', () => {
    it('should return true for "true"', () => {
      expect(parseBooleanSetting('true')).toBe(true);
    });

    it('should return false for "false"', () => {
      expect(parseBooleanSetting('false')).toBe(false);
    });

    it('should return undefined for "TRUE" (case-sensitive)', () => {
      expect(parseBooleanSetting('TRUE')).toBeUndefined();
    });

    it('should return undefined for "FALSE" (case-sensitive)', () => {
      expect(parseBooleanSetting('FALSE')).toBeUndefined();
    });

    it('should return undefined for "yes"', () => {
      expect(parseBooleanSetting('yes')).toBeUndefined();
    });

    it('should return undefined for "1"', () => {
      expect(parseBooleanSetting('1')).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(parseBooleanSetting('')).toBeUndefined();
    });
  });
});
