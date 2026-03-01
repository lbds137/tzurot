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
} from './channel.js';

/** Helper to create valid channel settings data */
function createValidChannelSettings(overrides = {}) {
  return {
    id: '550e8400-e29b-41d4-a716-446655440000',
    channelId: '123456789012345678',
    guildId: '987654321098765432',
    activatedPersonalityId: '550e8400-e29b-41d4-a716-446655440099',
    personalitySlug: 'lilith',
    personalityName: 'Lilith',
    autoRespond: true,
    activatedBy: '550e8400-e29b-41d4-a716-446655440001',
    createdAt: '2025-01-15T12:00:00.000Z',
    ...overrides,
  };
}

describe('Channel Settings Schemas', () => {
  describe('ChannelSettingsSchema', () => {
    it('should accept valid channel settings data', () => {
      const data = createValidChannelSettings();
      expect(ChannelSettingsSchema.parse(data)).toEqual(data);
    });

    it('should accept null guildId (for DM channels)', () => {
      const data = createValidChannelSettings({ guildId: null });
      expect(ChannelSettingsSchema.parse(data)).toEqual(data);
    });

    it('should accept null personalitySlug and personalityName (no activation)', () => {
      const data = createValidChannelSettings({
        personalitySlug: null,
        personalityName: null,
      });
      expect(ChannelSettingsSchema.parse(data)).toEqual(data);
    });

    it('should accept null activatedBy', () => {
      const data = createValidChannelSettings({ activatedBy: null });
      expect(ChannelSettingsSchema.parse(data)).toEqual(data);
    });

    it('should reject invalid UUID for id', () => {
      const data = createValidChannelSettings({ id: 'not-a-uuid' });
      expect(() => ChannelSettingsSchema.parse(data)).toThrow();
    });

    it('should reject empty channelId', () => {
      const data = createValidChannelSettings({ channelId: '' });
      expect(() => ChannelSettingsSchema.parse(data)).toThrow();
    });

    it('should reject empty personalitySlug (use null instead)', () => {
      const data = createValidChannelSettings({ personalitySlug: '' });
      expect(() => ChannelSettingsSchema.parse(data)).toThrow();
    });
  });

  describe('ActivateChannelRequestSchema', () => {
    it('should accept valid request data', () => {
      const data = {
        channelId: '123456789012345678',
        personalitySlug: 'lilith',
        guildId: '987654321098765432',
      };
      expect(ActivateChannelRequestSchema.parse(data)).toEqual(data);
    });

    it('should reject empty channelId', () => {
      const data = {
        channelId: '',
        personalitySlug: 'lilith',
        guildId: '987654321098765432',
      };
      expect(() => ActivateChannelRequestSchema.parse(data)).toThrow();
    });

    it('should reject empty personalitySlug', () => {
      const data = {
        channelId: '123456789012345678',
        personalitySlug: '',
        guildId: '987654321098765432',
      };
      expect(() => ActivateChannelRequestSchema.parse(data)).toThrow();
    });

    it('should reject empty guildId', () => {
      const data = {
        channelId: '123456789012345678',
        personalitySlug: 'lilith',
        guildId: '',
      };
      expect(() => ActivateChannelRequestSchema.parse(data)).toThrow();
    });

    it('should reject missing fields', () => {
      expect(() => ActivateChannelRequestSchema.parse({})).toThrow();
      expect(() => ActivateChannelRequestSchema.parse({ channelId: '123' })).toThrow();
    });
  });

  describe('ActivateChannelResponseSchema', () => {
    it('should accept valid response with replaced=false', () => {
      const data = {
        activation: createValidChannelSettings(),
        replaced: false,
      };
      expect(ActivateChannelResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept valid response with replaced=true', () => {
      const data = {
        activation: createValidChannelSettings({ activatedBy: null }),
        replaced: true,
      };
      expect(ActivateChannelResponseSchema.parse(data)).toEqual(data);
    });
  });

  describe('DeactivateChannelRequestSchema', () => {
    it('should accept valid request data', () => {
      const data = { channelId: '123456789012345678' };
      expect(DeactivateChannelRequestSchema.parse(data)).toEqual(data);
    });

    it('should reject empty channelId', () => {
      expect(() => DeactivateChannelRequestSchema.parse({ channelId: '' })).toThrow();
    });
  });

  describe('DeactivateChannelResponseSchema', () => {
    it('should accept response when something was deactivated', () => {
      const data = {
        deactivated: true,
        personalityName: 'Lilith',
      };
      expect(DeactivateChannelResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept response when nothing was deactivated', () => {
      const data = {
        deactivated: false,
      };
      expect(DeactivateChannelResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept response with optional personalityName omitted', () => {
      const data = { deactivated: true };
      expect(DeactivateChannelResponseSchema.parse(data)).toEqual(data);
    });
  });

  describe('GetChannelSettingsResponseSchema', () => {
    it('should accept response with settings', () => {
      const data = {
        hasSettings: true,
        settings: createValidChannelSettings(),
      };
      expect(GetChannelSettingsResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept response without settings', () => {
      const data = {
        hasSettings: false,
      };
      expect(GetChannelSettingsResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept response with hasSettings=false and no settings', () => {
      const data = {
        hasSettings: false,
        settings: undefined,
      };
      const result = GetChannelSettingsResponseSchema.parse(data);
      expect(result.hasSettings).toBe(false);
      expect(result.settings).toBeUndefined();
    });
  });

  // GetChannelActivationResponseSchema is for backward compatibility
  describe('GetChannelActivationResponseSchema (deprecated)', () => {
    it('should accept response with activation', () => {
      const data = {
        isActivated: true,
        activation: createValidChannelSettings(),
      };
      expect(GetChannelActivationResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept response without activation', () => {
      const data = {
        isActivated: false,
      };
      expect(GetChannelActivationResponseSchema.parse(data)).toEqual(data);
    });
  });

  describe('ListChannelSettingsResponseSchema', () => {
    it('should accept response with multiple settings', () => {
      const data = {
        settings: [
          createValidChannelSettings(),
          createValidChannelSettings({
            id: '550e8400-e29b-41d4-a716-446655440001',
            channelId: '123456789012345679',
            personalitySlug: 'sarcastic',
            personalityName: 'Sarcastic Bot',
            activatedBy: '550e8400-e29b-41d4-a716-446655440002',
            createdAt: '2025-01-15T13:00:00.000Z',
          }),
        ],
      };
      expect(ListChannelSettingsResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept empty settings array', () => {
      const data = { settings: [] };
      expect(ListChannelSettingsResponseSchema.parse(data)).toEqual(data);
    });
  });

  // ListChannelActivationsResponseSchema is for backward compatibility
  describe('ListChannelActivationsResponseSchema (deprecated)', () => {
    it('should accept response with multiple activations', () => {
      const data = {
        activations: [
          createValidChannelSettings(),
          createValidChannelSettings({
            id: '550e8400-e29b-41d4-a716-446655440001',
            channelId: '123456789012345679',
            personalitySlug: 'sarcastic',
            personalityName: 'Sarcastic Bot',
            activatedBy: '550e8400-e29b-41d4-a716-446655440002',
            createdAt: '2025-01-15T13:00:00.000Z',
          }),
        ],
      };
      expect(ListChannelActivationsResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept empty activations array', () => {
      const data = { activations: [] };
      expect(ListChannelActivationsResponseSchema.parse(data)).toEqual(data);
    });
  });

  describe('UpdateChannelGuildRequestSchema', () => {
    it('should accept valid request data', () => {
      const data = {
        channelId: '123456789012345678',
        guildId: '987654321098765432',
      };
      expect(UpdateChannelGuildRequestSchema.parse(data)).toEqual(data);
    });

    it('should reject empty channelId', () => {
      const data = {
        channelId: '',
        guildId: '987654321098765432',
      };
      expect(() => UpdateChannelGuildRequestSchema.parse(data)).toThrow();
    });

    it('should reject empty guildId', () => {
      const data = {
        channelId: '123456789012345678',
        guildId: '',
      };
      expect(() => UpdateChannelGuildRequestSchema.parse(data)).toThrow();
    });

    it('should reject missing fields', () => {
      expect(() => UpdateChannelGuildRequestSchema.parse({})).toThrow();
      expect(() => UpdateChannelGuildRequestSchema.parse({ channelId: '123' })).toThrow();
    });
  });

  describe('UpdateChannelGuildResponseSchema', () => {
    it('should accept response with updated=true', () => {
      const data = { updated: true };
      expect(UpdateChannelGuildResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept response with updated=false', () => {
      const data = { updated: false };
      expect(UpdateChannelGuildResponseSchema.parse(data)).toEqual(data);
    });

    it('should reject missing updated field', () => {
      expect(() => UpdateChannelGuildResponseSchema.parse({})).toThrow();
    });
  });
});
