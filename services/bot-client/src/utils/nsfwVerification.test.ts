/**
 * NSFW Verification Utilities Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelType } from 'discord.js';
import {
  checkNsfwVerification,
  verifyNsfwUser,
  isNsfwChannel,
  isDMChannel,
  NSFW_VERIFICATION_MESSAGE,
} from './nsfwVerification.js';
import * as userGatewayClient from './userGatewayClient.js';

// Mock the gateway client
vi.mock('./userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

describe('NSFW Verification Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkNsfwVerification', () => {
    it('should return verified status when API returns success', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
        },
      });

      const result = await checkNsfwVerification('user123');

      expect(result).toEqual({
        nsfwVerified: true,
        nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
      });
      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith('/user/nsfw', {
        method: 'GET',
        userId: 'user123',
      });
    });

    it('should return not verified when API fails', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'Server error',
        status: 500,
      });

      const result = await checkNsfwVerification('user123');

      expect(result).toEqual({
        nsfwVerified: false,
        nsfwVerifiedAt: null,
      });
    });
  });

  describe('verifyNsfwUser', () => {
    it('should return verification response on success', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
          alreadyVerified: false,
        },
      });

      const result = await verifyNsfwUser('user123');

      expect(result).toEqual({
        nsfwVerified: true,
        nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
        alreadyVerified: false,
      });
      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith('/user/nsfw/verify', {
        method: 'POST',
        userId: 'user123',
      });
    });

    it('should return null when API fails', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: false,
        error: 'Server error',
        status: 500,
      });

      const result = await verifyNsfwUser('user123');

      expect(result).toBeNull();
    });
  });

  describe('isNsfwChannel', () => {
    it('should return true for NSFW guild text channel', () => {
      const channel = {
        type: ChannelType.GuildText,
        nsfw: true,
      } as any;

      expect(isNsfwChannel(channel)).toBe(true);
    });

    it('should return false for non-NSFW guild text channel', () => {
      const channel = {
        type: ChannelType.GuildText,
        nsfw: false,
      } as any;

      expect(isNsfwChannel(channel)).toBe(false);
    });

    it('should return true for NSFW guild news channel', () => {
      const channel = {
        type: ChannelType.GuildNews,
        nsfw: true,
      } as any;

      expect(isNsfwChannel(channel)).toBe(true);
    });

    it('should return false for DM channel (cannot be NSFW)', () => {
      const channel = {
        type: ChannelType.DM,
      } as any;

      expect(isNsfwChannel(channel)).toBe(false);
    });

    it('should return false for thread channel', () => {
      const channel = {
        type: ChannelType.PublicThread,
      } as any;

      expect(isNsfwChannel(channel)).toBe(false);
    });
  });

  describe('isDMChannel', () => {
    it('should return true for DM channel', () => {
      const channel = {
        type: ChannelType.DM,
      } as any;

      expect(isDMChannel(channel)).toBe(true);
    });

    it('should return false for guild text channel', () => {
      const channel = {
        type: ChannelType.GuildText,
      } as any;

      expect(isDMChannel(channel)).toBe(false);
    });

    it('should return false for guild voice channel', () => {
      const channel = {
        type: ChannelType.GuildVoice,
      } as any;

      expect(isDMChannel(channel)).toBe(false);
    });
  });

  describe('NSFW_VERIFICATION_MESSAGE', () => {
    it('should contain key information', () => {
      expect(NSFW_VERIFICATION_MESSAGE).toContain('Age Verification');
      expect(NSFW_VERIFICATION_MESSAGE).toContain('NSFW');
      expect(NSFW_VERIFICATION_MESSAGE).toContain('@personality_name');
      expect(NSFW_VERIFICATION_MESSAGE).toContain('18+');
    });
  });
});
