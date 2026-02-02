/**
 * NSFW Verification Utilities Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelType, GuildNSFWLevel } from 'discord.js';
import {
  checkNsfwVerification,
  verifyNsfwUser,
  isNsfwChannel,
  isDMChannel,
  NSFW_VERIFICATION_MESSAGE,
  handleNsfwVerification,
  sendNsfwVerificationMessage,
  sendVerificationConfirmation,
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
    describe('server-level age restriction', () => {
      it('should return true for any channel in age-restricted server', () => {
        const channel = {
          type: ChannelType.GuildText,
          nsfw: false, // Channel itself is NOT nsfw
          guild: {
            nsfwLevel: GuildNSFWLevel.AgeRestricted,
          },
        } as any;

        expect(isNsfwChannel(channel)).toBe(true);
      });

      it('should return false for channel in server with Default nsfwLevel', () => {
        const channel = {
          type: ChannelType.GuildText,
          nsfw: false,
          guild: {
            nsfwLevel: GuildNSFWLevel.Default,
          },
        } as any;

        expect(isNsfwChannel(channel)).toBe(false);
      });

      it('should return false for channel in server with Explicit nsfwLevel (content filter, not age gate)', () => {
        // GuildNSFWLevel.Explicit is about content filtering, NOT age restriction
        const channel = {
          type: ChannelType.GuildText,
          nsfw: false,
          guild: {
            nsfwLevel: GuildNSFWLevel.Explicit,
          },
        } as any;

        expect(isNsfwChannel(channel)).toBe(false);
      });

      it('should return false for channel in server with Safe nsfwLevel', () => {
        const channel = {
          type: ChannelType.GuildText,
          nsfw: false,
          guild: {
            nsfwLevel: GuildNSFWLevel.Safe,
          },
        } as any;

        expect(isNsfwChannel(channel)).toBe(false);
      });

      it('should handle channel without guild property', () => {
        const channel = {
          type: ChannelType.GuildText,
          nsfw: false,
        } as any;

        expect(isNsfwChannel(channel)).toBe(false);
      });

      it('should handle channel with null guild', () => {
        const channel = {
          type: ChannelType.GuildText,
          nsfw: false,
          guild: null,
        } as any;

        expect(isNsfwChannel(channel)).toBe(false);
      });
    });

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

    it('should return false for thread with no parent', () => {
      const channel = {
        type: ChannelType.PublicThread,
        parent: null,
      } as any;

      expect(isNsfwChannel(channel)).toBe(false);
    });

    it('should return true for public thread with NSFW parent text channel', () => {
      const channel = {
        type: ChannelType.PublicThread,
        parent: {
          type: ChannelType.GuildText,
          nsfw: true,
        },
      } as any;

      expect(isNsfwChannel(channel)).toBe(true);
    });

    it('should return false for public thread with non-NSFW parent', () => {
      const channel = {
        type: ChannelType.PublicThread,
        parent: {
          type: ChannelType.GuildText,
          nsfw: false,
        },
      } as any;

      expect(isNsfwChannel(channel)).toBe(false);
    });

    it('should return true for private thread with NSFW parent', () => {
      const channel = {
        type: ChannelType.PrivateThread,
        parent: {
          type: ChannelType.GuildText,
          nsfw: true,
        },
      } as any;

      expect(isNsfwChannel(channel)).toBe(true);
    });

    it('should return true for announcement thread with NSFW parent news channel', () => {
      const channel = {
        type: ChannelType.AnnouncementThread,
        parent: {
          type: ChannelType.GuildNews,
          nsfw: true,
        },
      } as any;

      expect(isNsfwChannel(channel)).toBe(true);
    });

    it('should return true for thread with NSFW forum parent', () => {
      const channel = {
        type: ChannelType.PublicThread,
        parent: {
          type: ChannelType.GuildForum,
          nsfw: true,
        },
      } as any;

      expect(isNsfwChannel(channel)).toBe(true);
    });

    it('should return false for thread with non-text parent', () => {
      const channel = {
        type: ChannelType.PublicThread,
        parent: {
          type: ChannelType.GuildVoice,
        },
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

  describe('sendNsfwVerificationMessage', () => {
    it('should send verification message and track it', async () => {
      const mockReply = { id: 'reply-123', channelId: 'channel-456' };
      const mockMessage = {
        id: 'msg-789',
        author: { id: 'user-123' },
        reply: vi.fn().mockResolvedValue(mockReply),
      } as any;

      await sendNsfwVerificationMessage(mockMessage, 'TestProcessor');

      expect(mockMessage.reply).toHaveBeenCalledWith(NSFW_VERIFICATION_MESSAGE);
    });

    it('should handle reply failure gracefully', async () => {
      const mockMessage = {
        id: 'msg-789',
        author: { id: 'user-123' },
        reply: vi.fn().mockRejectedValue(new Error('Cannot send message')),
      } as any;

      // Should not throw
      await expect(
        sendNsfwVerificationMessage(mockMessage, 'TestProcessor')
      ).resolves.toBeUndefined();
    });
  });

  describe('handleNsfwVerification', () => {
    it('should auto-verify in NSFW channel and return allowed=true', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
          alreadyVerified: false,
        },
      });

      const mockMessage = {
        author: { id: 'user-123' },
        channel: {
          type: ChannelType.GuildText,
          nsfw: true,
        },
        reply: vi.fn(),
      } as any;

      const result = await handleNsfwVerification(mockMessage, 'TestProcessor');

      expect(result).toEqual({ allowed: true, wasNewVerification: true });
      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith('/user/nsfw/verify', {
        method: 'POST',
        userId: 'user-123',
      });
    });

    it('should return wasNewVerification=false when already verified', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
          alreadyVerified: true,
        },
      });

      const mockMessage = {
        author: { id: 'user-123' },
        channel: {
          type: ChannelType.GuildText,
          nsfw: true,
        },
        reply: vi.fn(),
      } as any;

      const result = await handleNsfwVerification(mockMessage, 'TestProcessor');

      expect(result).toEqual({ allowed: true, wasNewVerification: false });
    });

    it('should allow verified user in non-NSFW channel', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
        },
      });

      const mockMessage = {
        author: { id: 'user-123' },
        channel: {
          type: ChannelType.GuildText,
          nsfw: false,
        },
        reply: vi.fn(),
      } as any;

      const result = await handleNsfwVerification(mockMessage, 'TestProcessor');

      expect(result).toEqual({ allowed: true, wasNewVerification: false });
      expect(userGatewayClient.callGatewayApi).toHaveBeenCalledWith('/user/nsfw', {
        method: 'GET',
        userId: 'user-123',
      });
    });

    it('should block unverified user in non-NSFW channel and send message', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          nsfwVerified: false,
          nsfwVerifiedAt: null,
        },
      });

      const mockReply = { id: 'reply-123', channelId: 'channel-456' };
      const mockMessage = {
        id: 'msg-789',
        author: { id: 'user-123' },
        channel: {
          type: ChannelType.DM,
        },
        reply: vi.fn().mockResolvedValue(mockReply),
      } as any;

      const result = await handleNsfwVerification(mockMessage, 'TestProcessor');

      expect(result).toEqual({ allowed: false, wasNewVerification: false });
      expect(mockMessage.reply).toHaveBeenCalledWith(NSFW_VERIFICATION_MESSAGE);
    });

    it('should auto-verify in thread with NSFW parent', async () => {
      vi.mocked(userGatewayClient.callGatewayApi).mockResolvedValue({
        ok: true,
        data: {
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
          alreadyVerified: false,
        },
      });

      const mockMessage = {
        author: { id: 'user-123' },
        channel: {
          type: ChannelType.PublicThread,
          parent: {
            type: ChannelType.GuildText,
            nsfw: true,
          },
        },
        reply: vi.fn(),
      } as any;

      const result = await handleNsfwVerification(mockMessage, 'TestProcessor');

      expect(result).toEqual({ allowed: true, wasNewVerification: true });
    });
  });

  describe('sendVerificationConfirmation', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should send confirmation message and delete after timeout', async () => {
      const mockDelete = vi.fn().mockResolvedValue(undefined);
      const mockSentMessage = { delete: mockDelete };
      const mockChannel = {
        send: vi.fn().mockResolvedValue(mockSentMessage),
      } as any;

      await sendVerificationConfirmation(mockChannel, 5000);

      expect(mockChannel.send).toHaveBeenCalledWith(
        '✅ **NSFW verification complete!** You can now chat with personalities anywhere.'
      );

      // Message should not be deleted yet
      expect(mockDelete).not.toHaveBeenCalled();

      // Advance timer
      await vi.advanceTimersByTimeAsync(5000);

      expect(mockDelete).toHaveBeenCalled();
    });

    it('should handle send failure gracefully', async () => {
      const mockChannel = {
        send: vi.fn().mockRejectedValue(new Error('No permissions')),
      } as any;

      // Should not throw
      await expect(sendVerificationConfirmation(mockChannel)).resolves.toBeUndefined();
    });

    it('should handle delete failure gracefully', async () => {
      const mockDelete = vi.fn().mockRejectedValue(new Error('Message already deleted'));
      const mockSentMessage = { delete: mockDelete };
      const mockChannel = {
        send: vi.fn().mockResolvedValue(mockSentMessage),
      } as any;

      await sendVerificationConfirmation(mockChannel, 1000);
      await vi.advanceTimersByTimeAsync(1000);

      // Should not throw even if delete fails
      expect(mockDelete).toHaveBeenCalled();
    });
  });
});
