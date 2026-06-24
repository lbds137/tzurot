/**
 * NSFW Verification Utilities Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChannelType, GuildNSFWLevel } from 'discord.js';
import { makeOk, makeErr, asUserClient } from '../test/gatewayClientStubs.js';

interface UserClientStub {
  actor: string;
  getNsfwStatus: ReturnType<typeof vi.fn>;
  verifyNsfw: ReturnType<typeof vi.fn>;
}

function createStub(discordId = 'user123'): UserClientStub {
  return {
    actor: discordId,
    getNsfwStatus: vi.fn(),
    verifyNsfw: vi.fn(),
  };
}

const clientsForUserMock = vi.hoisted(() => vi.fn());
vi.mock('./gatewayClients.js', () => ({
  clientsForUser: clientsForUserMock,
}));

const {
  checkNsfwVerification,
  verifyNsfwUser,
  isNsfwChannel,
  isDMChannel,
  NSFW_VERIFICATION_MESSAGE,
  NSFW_VERIFICATION_CHECK_FAILED_MESSAGE,
  handleNsfwVerification,
  sendNsfwVerificationMessage,
  sendVerificationConfirmation,
} = await import('./nsfwVerification.js');

describe('NSFW Verification Utilities', () => {
  let stub: UserClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub('user-123');
    clientsForUserMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('checkNsfwVerification', () => {
    it('should return kind=ok with verified status when API returns success', async () => {
      stub.getNsfwStatus.mockResolvedValue(
        makeOk({
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
        })
      );

      const result = await checkNsfwVerification(asUserClient(stub));

      expect(result).toEqual({
        kind: 'ok',
        value: {
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
        },
      });
      expect(stub.getNsfwStatus).toHaveBeenCalled();
    });

    it('should return kind=error when API fails (distinguishable from unverified)', async () => {
      stub.getNsfwStatus.mockResolvedValue(makeErr(500, 'Server error'));

      const result = await checkNsfwVerification(asUserClient(stub));

      expect(result).toEqual({
        kind: 'error',
        error: 'Server error',
      });
    });
  });

  describe('verifyNsfwUser', () => {
    it('should return verification response on success', async () => {
      stub.verifyNsfw.mockResolvedValue(
        makeOk({
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
          alreadyVerified: false,
        })
      );

      const result = await verifyNsfwUser(asUserClient(stub));

      expect(result).toEqual({
        nsfwVerified: true,
        nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
        alreadyVerified: false,
      });
      expect(stub.verifyNsfw).toHaveBeenCalled();
    });

    it('should return null when API fails', async () => {
      stub.verifyNsfw.mockResolvedValue(makeErr(500, 'Server error'));

      const result = await verifyNsfwUser(asUserClient(stub));

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
      // Both verification paths must be documented: personality ping AND direct bot ping.
      // The direct-ping path is what BotMentionProcessor's handleNsfwVerification wiring
      // produces; the personality ping is the original webhook trigger.
      expect(NSFW_VERIFICATION_MESSAGE).toContain('ping me directly');
    });
  });

  describe('sendNsfwVerificationMessage', () => {
    it('should send verification message and track it', async () => {
      const mockReply = { id: 'reply-123', channelId: 'channel-456' };
      const mockMessage = {
        id: 'msg-789',
        author: { id: 'user-123', username: 'testuser' },
        reply: vi.fn().mockResolvedValue(mockReply),
      } as any;

      await sendNsfwVerificationMessage(mockMessage);

      expect(mockMessage.reply).toHaveBeenCalledWith(NSFW_VERIFICATION_MESSAGE);
    });

    it('should handle reply failure gracefully', async () => {
      const mockMessage = {
        id: 'msg-789',
        author: { id: 'user-123', username: 'testuser' },
        reply: vi.fn().mockRejectedValue(new Error('Cannot send message')),
      } as any;

      // Should not throw
      await expect(sendNsfwVerificationMessage(mockMessage)).resolves.toBeUndefined();
    });
  });

  describe('handleNsfwVerification', () => {
    it('should auto-verify in NSFW channel and return allowed=true', async () => {
      stub.verifyNsfw.mockResolvedValue(
        makeOk({
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
          alreadyVerified: false,
        })
      );

      const mockMessage = {
        author: { id: 'user-123', username: 'testuser' },
        channel: {
          type: ChannelType.GuildText,
          nsfw: true,
        },
        reply: vi.fn(),
      } as any;

      const result = await handleNsfwVerification(mockMessage);

      expect(result).toEqual({ allowed: true, wasNewVerification: true });
      expect(stub.verifyNsfw).toHaveBeenCalled();
    });

    it('should return wasNewVerification=false when already verified', async () => {
      stub.verifyNsfw.mockResolvedValue(
        makeOk({
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
          alreadyVerified: true,
        })
      );

      const mockMessage = {
        author: { id: 'user-123', username: 'testuser' },
        channel: {
          type: ChannelType.GuildText,
          nsfw: true,
        },
        reply: vi.fn(),
      } as any;

      const result = await handleNsfwVerification(mockMessage);

      expect(result).toEqual({ allowed: true, wasNewVerification: false });
    });

    it('should allow verified user in non-NSFW channel', async () => {
      stub.getNsfwStatus.mockResolvedValue(
        makeOk({
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
        })
      );

      const mockMessage = {
        author: { id: 'user-123', username: 'testuser' },
        channel: {
          type: ChannelType.GuildText,
          nsfw: false,
        },
        reply: vi.fn(),
      } as any;

      const result = await handleNsfwVerification(mockMessage);

      expect(result).toEqual({ allowed: true, wasNewVerification: false });
      expect(stub.getNsfwStatus).toHaveBeenCalled();
    });

    it('should block with distinct retry message when NSFW check fails (fail-closed)', async () => {
      stub.getNsfwStatus.mockResolvedValue(makeErr(504, 'Gateway timeout'));

      const mockReply = { id: 'reply-retry', channelId: 'channel-789' };
      const mockMessage = {
        id: 'msg-retry',
        author: { id: 'user-123', username: 'testuser' },
        channel: {
          type: ChannelType.DM,
        },
        reply: vi.fn().mockResolvedValue(mockReply),
      } as any;

      const result = await handleNsfwVerification(mockMessage);

      expect(result).toEqual({ allowed: false, wasNewVerification: false });
      expect(mockMessage.reply).toHaveBeenCalledWith(NSFW_VERIFICATION_CHECK_FAILED_MESSAGE);
      // Must NOT send the full verification education message — a previously
      // verified user shouldn't be re-onboarded because of a transient blip.
      expect(mockMessage.reply).not.toHaveBeenCalledWith(NSFW_VERIFICATION_MESSAGE);
    });

    it('should block unverified user in non-NSFW channel and send message', async () => {
      stub.getNsfwStatus.mockResolvedValue(
        makeOk({
          nsfwVerified: false,
          nsfwVerifiedAt: null,
        })
      );

      const mockReply = { id: 'reply-123', channelId: 'channel-456' };
      const mockMessage = {
        id: 'msg-789',
        author: { id: 'user-123', username: 'testuser' },
        channel: {
          type: ChannelType.DM,
        },
        reply: vi.fn().mockResolvedValue(mockReply),
      } as any;

      const result = await handleNsfwVerification(mockMessage);

      expect(result).toEqual({ allowed: false, wasNewVerification: false });
      expect(mockMessage.reply).toHaveBeenCalledWith(NSFW_VERIFICATION_MESSAGE);
    });

    it('should auto-verify in thread with NSFW parent', async () => {
      stub.verifyNsfw.mockResolvedValue(
        makeOk({
          nsfwVerified: true,
          nsfwVerifiedAt: '2024-01-15T10:00:00.000Z',
          alreadyVerified: false,
        })
      );

      const mockMessage = {
        author: { id: 'user-123', username: 'testuser' },
        channel: {
          type: ChannelType.PublicThread,
          parent: {
            type: ChannelType.GuildText,
            nsfw: true,
          },
        },
        reply: vi.fn(),
      } as any;

      const result = await handleNsfwVerification(mockMessage);

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
        '✅ **NSFW verification complete!** You can now chat with characters anywhere.'
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
