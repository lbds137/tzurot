/**
 * Channel API Contract Tests
 *
 * Validates schemas for /user/channel endpoints.
 * Note: There is also a channel.test.ts in schemas/api/ that uses .parse()
 * but the audit requires .safeParse() in types/*.schema.test.ts files.
 */

import { describe, it, expect } from 'vitest';
import {
  ChannelSettingsSchema,
  ActivateChannelRequestSchema,
  ActivateChannelResponseSchema,
  DeactivateChannelRequestSchema,
  DeactivateChannelResponseSchema,
  GetChannelSettingsResponseSchema,
  GetChannelActivationResponseSchema,
  ListChannelSettingsResponseSchema,
  ListChannelActivationsResponseSchema,
  UpdateChannelGuildRequestSchema,
  UpdateChannelGuildResponseSchema,
} from '../schemas/api/index.js';

/** Helper to create valid channel settings data */
function createValidSettings(overrides = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    channelId: '123456789012345678',
    guildId: '987654321098765432',
    personalitySlug: 'lilith',
    personalityName: 'Lilith',
    autoRespond: true,
    activatedBy: '550e8400-e29b-41d4-a716-446655440001',
    createdAt: '2025-01-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('Channel API Contract Tests', () => {
  describe('ChannelSettingsSchema', () => {
    it('should accept valid channel settings', () => {
      const data = createValidSettings();
      const result = ChannelSettingsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept null guildId for DM channels', () => {
      const data = createValidSettings({ guildId: null });
      const result = ChannelSettingsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept null personality fields (no activation)', () => {
      const data = createValidSettings({ personalitySlug: null, personalityName: null });
      const result = ChannelSettingsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept null activatedBy', () => {
      const data = createValidSettings({ activatedBy: null });
      const result = ChannelSettingsSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject invalid UUID for id', () => {
      const data = createValidSettings({ id: 'not-a-uuid' });
      const result = ChannelSettingsSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('should reject empty channelId', () => {
      const data = createValidSettings({ channelId: '' });
      const result = ChannelSettingsSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('ActivateChannelRequestSchema', () => {
    it('should accept valid request', () => {
      const data = {
        channelId: '123456789012345678',
        personalitySlug: 'lilith',
        guildId: '987654321098765432',
      };
      const result = ActivateChannelRequestSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject empty fields', () => {
      const result = ActivateChannelRequestSchema.safeParse({
        channelId: '',
        personalitySlug: '',
        guildId: '',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing fields', () => {
      const result = ActivateChannelRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('ActivateChannelResponseSchema', () => {
    it('should accept valid response with replaced=false', () => {
      const data = { activation: createValidSettings(), replaced: false };
      const result = ActivateChannelResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept valid response with replaced=true', () => {
      const data = { activation: createValidSettings(), replaced: true };
      const result = ActivateChannelResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing activation', () => {
      const result = ActivateChannelResponseSchema.safeParse({ replaced: false });
      expect(result.success).toBe(false);
    });
  });

  describe('DeactivateChannelRequestSchema', () => {
    it('should accept valid request', () => {
      const data = { channelId: '123456789012345678' };
      const result = DeactivateChannelRequestSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject empty channelId', () => {
      const result = DeactivateChannelRequestSchema.safeParse({ channelId: '' });
      expect(result.success).toBe(false);
    });
  });

  describe('DeactivateChannelResponseSchema', () => {
    it('should accept response with deactivation', () => {
      const data = { deactivated: true, personalityName: 'Lilith' };
      const result = DeactivateChannelResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept response without personalityName', () => {
      const data = { deactivated: false };
      const result = DeactivateChannelResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('GetChannelSettingsResponseSchema', () => {
    it('should accept response with settings', () => {
      const data = { hasSettings: true, settings: createValidSettings() };
      const result = GetChannelSettingsResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept response without settings', () => {
      const data = { hasSettings: false };
      const result = GetChannelSettingsResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('GetChannelActivationResponseSchema (deprecated)', () => {
    it('should accept response with activation', () => {
      const data = { isActivated: true, activation: createValidSettings() };
      const result = GetChannelActivationResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept response without activation', () => {
      const data = { isActivated: false };
      const result = GetChannelActivationResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('ListChannelSettingsResponseSchema', () => {
    it('should accept response with settings', () => {
      const data = { settings: [createValidSettings()] };
      const result = ListChannelSettingsResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept empty settings array', () => {
      const data = { settings: [] };
      const result = ListChannelSettingsResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('ListChannelActivationsResponseSchema (deprecated)', () => {
    it('should accept response with activations', () => {
      const data = { activations: [createValidSettings()] };
      const result = ListChannelActivationsResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept empty activations array', () => {
      const data = { activations: [] };
      const result = ListChannelActivationsResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('UpdateChannelGuildRequestSchema', () => {
    it('should accept valid request', () => {
      const data = { channelId: '123456789012345678', guildId: '987654321098765432' };
      const result = UpdateChannelGuildRequestSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject empty channelId', () => {
      const result = UpdateChannelGuildRequestSchema.safeParse({
        channelId: '',
        guildId: '987654321098765432',
      });
      expect(result.success).toBe(false);
    });

    it('should reject missing fields', () => {
      const result = UpdateChannelGuildRequestSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });

  describe('UpdateChannelGuildResponseSchema', () => {
    it('should accept response with updated=true', () => {
      const data = { updated: true };
      const result = UpdateChannelGuildResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should accept response with updated=false', () => {
      const data = { updated: false };
      const result = UpdateChannelGuildResponseSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('should reject missing updated field', () => {
      const result = UpdateChannelGuildResponseSchema.safeParse({});
      expect(result.success).toBe(false);
    });
  });
});
