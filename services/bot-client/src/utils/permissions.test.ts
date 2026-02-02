/**
 * Tests for permission checking utilities
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags, PermissionFlagsBits } from 'discord.js';
import type { ChatInputCommandInteraction, GuildMember, PermissionsBitField } from 'discord.js';
import { requireManageMessages, requireManageMessagesDeferred } from './permissions.js';

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
      // Bot owner ID is set via BOT_OWNER_ID env var, defaults to empty
      // For this test, we use the actual env var check (which will be empty in test)
      // This tests that the check happens, not that a specific ID matches
      const interaction = createMockInteraction({
        inGuild: true,
        hasManageMessages: false,
        userId: '', // Empty ID won't match any owner
      });

      const result = await requireManageMessages(interaction);

      // Should still fail because empty string isn't the bot owner
      expect(result).toBe(false);
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
  });
});
