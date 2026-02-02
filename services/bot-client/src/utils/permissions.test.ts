/**
 * Tests for permission checking utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction, GuildMember, PermissionsBitField } from 'discord.js';

// Mock isBotOwner before importing permissions
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    isBotOwner: vi.fn().mockReturnValue(false),
  };
});

import { requireManageMessages, requireManageMessagesDeferred } from './permissions.js';
import { isBotOwner } from '@tzurot/common-types';

describe('permissions utilities', () => {
  // Create a mock interaction factory
  function createMockInteraction(options: {
    inGuild?: boolean;
    hasManageMessages?: boolean;
    deferred?: boolean;
    userId?: string;
  }): ChatInputCommandInteraction {
    const {
      inGuild = true,
      hasManageMessages = true,
      deferred = false,
      userId = 'regular-user-123', // Non-owner user ID by default
    } = options;

    const mockPermissions = {
      has: vi.fn((permission: bigint) => {
        if (permission === PermissionFlagsBits.ManageMessages) {
          return hasManageMessages;
        }
        return false;
      }),
    } as unknown as PermissionsBitField;

    const mockMember = {
      permissions: mockPermissions,
    } as GuildMember;

    return {
      inGuild: vi.fn().mockReturnValue(inGuild),
      member: mockMember,
      user: { id: userId },
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      deferred,
    } as unknown as ChatInputCommandInteraction;
  }

  describe('requireManageMessages', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return true when user has ManageMessages permission in guild', async () => {
      const interaction = createMockInteraction({
        inGuild: true,
        hasManageMessages: true,
      });

      const result = await requireManageMessages(interaction);

      expect(result).toBe(true);
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should return false and reply when not in guild', async () => {
      const interaction = createMockInteraction({
        inGuild: false,
      });

      const result = await requireManageMessages(interaction);

      expect(result).toBe(false);
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ This command can only be used in a server.',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should return false and reply when user lacks ManageMessages permission', async () => {
      const interaction = createMockInteraction({
        inGuild: true,
        hasManageMessages: false,
      });

      const result = await requireManageMessages(interaction);

      expect(result).toBe(false);
      expect(interaction.reply).toHaveBeenCalledWith({
        content: '❌ You need the "Manage Messages" permission to use this command.',
        flags: MessageFlags.Ephemeral,
      });
    });

    it('should return true for bot owner even without ManageMessages permission', async () => {
      // Mock isBotOwner to return true for this test
      vi.mocked(isBotOwner).mockReturnValueOnce(true);

      const interaction = createMockInteraction({
        inGuild: true,
        hasManageMessages: false,
        userId: 'bot-owner-123',
      });

      const result = await requireManageMessages(interaction);

      expect(result).toBe(true);
      expect(isBotOwner).toHaveBeenCalledWith('bot-owner-123');
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it('should check permissions normally for non-bot-owner', async () => {
      // Mock isBotOwner to return false
      vi.mocked(isBotOwner).mockReturnValueOnce(false);

      const interaction = createMockInteraction({
        inGuild: true,
        hasManageMessages: false,
        userId: 'regular-user-456',
      });

      const result = await requireManageMessages(interaction);

      expect(result).toBe(false);
      expect(isBotOwner).toHaveBeenCalledWith('regular-user-456');
    });
  });

  describe('requireManageMessagesDeferred', () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it('should return true when user has ManageMessages permission in guild', async () => {
      const interaction = createMockInteraction({
        inGuild: true,
        hasManageMessages: true,
        deferred: true,
      });

      const result = await requireManageMessagesDeferred(interaction);

      expect(result).toBe(true);
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it('should return false and editReply when not in guild', async () => {
      const interaction = createMockInteraction({
        inGuild: false,
        deferred: true,
      });

      const result = await requireManageMessagesDeferred(interaction);

      expect(result).toBe(false);
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ This command can only be used in a server.',
      });
    });

    it('should return false and editReply when user lacks ManageMessages permission', async () => {
      const interaction = createMockInteraction({
        inGuild: true,
        hasManageMessages: false,
        deferred: true,
      });

      const result = await requireManageMessagesDeferred(interaction);

      expect(result).toBe(false);
      expect(interaction.editReply).toHaveBeenCalledWith({
        content: '❌ You need the "Manage Messages" permission to use this command.',
      });
    });

    it('should return true for bot owner even without ManageMessages permission', async () => {
      vi.mocked(isBotOwner).mockReturnValueOnce(true);

      const interaction = createMockInteraction({
        inGuild: true,
        hasManageMessages: false,
        deferred: true,
        userId: 'bot-owner-123',
      });

      const result = await requireManageMessagesDeferred(interaction);

      expect(result).toBe(true);
      expect(isBotOwner).toHaveBeenCalledWith('bot-owner-123');
      expect(interaction.editReply).not.toHaveBeenCalled();
    });
  });
});
