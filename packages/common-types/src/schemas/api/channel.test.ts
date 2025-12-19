import { describe, it, expect } from 'vitest';
import {
  ActivatedChannelSchema,
  ActivateChannelRequestSchema,
  ActivateChannelResponseSchema,
  DeactivateChannelRequestSchema,
  DeactivateChannelResponseSchema,
  GetChannelActivationResponseSchema,
  ListChannelActivationsResponseSchema,
} from './channel.js';

describe('Channel Activation Schemas', () => {
  describe('ActivatedChannelSchema', () => {
    it('should accept valid activated channel data', () => {
      const data = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        channelId: '123456789012345678',
        personalitySlug: 'lilith',
        personalityName: 'Lilith',
        activatedBy: '550e8400-e29b-41d4-a716-446655440001',
        createdAt: '2025-01-15T12:00:00.000Z',
      };
      expect(ActivatedChannelSchema.parse(data)).toEqual(data);
    });

    it('should accept null activatedBy', () => {
      const data = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        channelId: '123456789012345678',
        personalitySlug: 'lilith',
        personalityName: 'Lilith',
        activatedBy: null,
        createdAt: '2025-01-15T12:00:00.000Z',
      };
      expect(ActivatedChannelSchema.parse(data)).toEqual(data);
    });

    it('should reject invalid UUID for id', () => {
      const data = {
        id: 'not-a-uuid',
        channelId: '123456789012345678',
        personalitySlug: 'lilith',
        personalityName: 'Lilith',
        activatedBy: null,
        createdAt: '2025-01-15T12:00:00.000Z',
      };
      expect(() => ActivatedChannelSchema.parse(data)).toThrow();
    });

    it('should reject empty channelId', () => {
      const data = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        channelId: '',
        personalitySlug: 'lilith',
        personalityName: 'Lilith',
        activatedBy: null,
        createdAt: '2025-01-15T12:00:00.000Z',
      };
      expect(() => ActivatedChannelSchema.parse(data)).toThrow();
    });

    it('should reject empty personalitySlug', () => {
      const data = {
        id: '550e8400-e29b-41d4-a716-446655440000',
        channelId: '123456789012345678',
        personalitySlug: '',
        personalityName: 'Lilith',
        activatedBy: null,
        createdAt: '2025-01-15T12:00:00.000Z',
      };
      expect(() => ActivatedChannelSchema.parse(data)).toThrow();
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
        activation: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          channelId: '123456789012345678',
          personalitySlug: 'lilith',
          personalityName: 'Lilith',
          activatedBy: '550e8400-e29b-41d4-a716-446655440001',
          createdAt: '2025-01-15T12:00:00.000Z',
        },
        replaced: false,
      };
      expect(ActivateChannelResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept valid response with replaced=true', () => {
      const data = {
        activation: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          channelId: '123456789012345678',
          personalitySlug: 'lilith',
          personalityName: 'Lilith',
          activatedBy: null,
          createdAt: '2025-01-15T12:00:00.000Z',
        },
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

  describe('GetChannelActivationResponseSchema', () => {
    it('should accept response with activation', () => {
      const data = {
        isActivated: true,
        activation: {
          id: '550e8400-e29b-41d4-a716-446655440000',
          channelId: '123456789012345678',
          personalitySlug: 'lilith',
          personalityName: 'Lilith',
          activatedBy: null,
          createdAt: '2025-01-15T12:00:00.000Z',
        },
      };
      expect(GetChannelActivationResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept response without activation', () => {
      const data = {
        isActivated: false,
      };
      expect(GetChannelActivationResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept response with isActivated=false and no activation', () => {
      const data = {
        isActivated: false,
        activation: undefined,
      };
      const result = GetChannelActivationResponseSchema.parse(data);
      expect(result.isActivated).toBe(false);
      expect(result.activation).toBeUndefined();
    });
  });

  describe('ListChannelActivationsResponseSchema', () => {
    it('should accept response with multiple activations', () => {
      const data = {
        activations: [
          {
            id: '550e8400-e29b-41d4-a716-446655440000',
            channelId: '123456789012345678',
            personalitySlug: 'lilith',
            personalityName: 'Lilith',
            activatedBy: null,
            createdAt: '2025-01-15T12:00:00.000Z',
          },
          {
            id: '550e8400-e29b-41d4-a716-446655440001',
            channelId: '123456789012345679',
            personalitySlug: 'sarcastic',
            personalityName: 'Sarcastic Bot',
            activatedBy: '550e8400-e29b-41d4-a716-446655440002',
            createdAt: '2025-01-15T13:00:00.000Z',
          },
        ],
      };
      expect(ListChannelActivationsResponseSchema.parse(data)).toEqual(data);
    });

    it('should accept empty activations array', () => {
      const data = { activations: [] };
      expect(ListChannelActivationsResponseSchema.parse(data)).toEqual(data);
    });
  });
});
