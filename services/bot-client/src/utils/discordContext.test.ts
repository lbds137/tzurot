/**
 * Tests for Discord Context Utilities
 *
 * Tests the extraction and formatting of Discord environment context
 *
 * Note: Test override object literals trigger TypeScript errors due to Object.prototype methods.
 * These don't affect runtime behavior. Tests pass successfully (17 tests).
 */

// @ts-nocheck - Test override literals have Object.prototype method conflicts that don't affect runtime
import { describe, it, expect } from 'vitest';
import { ChannelType } from 'discord.js';
import { extractDiscordEnvironment, formatEnvironmentForPrompt } from './discordContext.js';
import {
  createMockMessage,
  createMockDMMessage,
  createMockThreadMessage,
  createMockTextChannel,
  createMockGuild,
  createMockCategoryChannel,
  createMockThreadChannel,
} from '../test/mocks/Discord.mock.js';

describe('extractDiscordEnvironment', () => {
  describe('DM Channels', () => {
    it('should correctly identify a DM channel', () => {
      const message = createMockDMMessage();
      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('dm');
      expect(result.channel.type).toBe('dm');
      expect(result.channel.name).toBe('Direct Message');
    });

    it('should include channel ID for DM', () => {
      const message = createMockDMMessage();
      const result = extractDiscordEnvironment(message);

      expect(result.channel.id).toBe(message.channel.id);
    });
  });

  describe('Guild Channels', () => {
    it('should correctly identify a guild text channel', () => {
      const guild = createMockGuild({ id: 'test-guild-123', name: 'Test Server' });
      const channel = createMockTextChannel({ id: 'test-channel-456', name: 'general', guild });
      const message = createMockMessage({ guild, channel });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('guild');
      expect(result.guild).toEqual({
        id: 'test-guild-123',
        name: 'Test Server',
      });
      expect(result.channel).toEqual({
        id: 'test-channel-456',
        name: 'general',
        type: 'text',
      });
    });

    it('should include category information when present', () => {
      const guild = createMockGuild();
      const category = createMockCategoryChannel({ id: 'cat-123', name: 'Community' });
      const channel = createMockTextChannel({ name: 'chat', guild, parent: category });
      const message = createMockMessage({ guild, channel });

      const result = extractDiscordEnvironment(message);

      expect(result.category).toEqual({
        id: 'cat-123',
        name: 'Community',
      });
    });

    it('should handle channel without category', () => {
      const guild = createMockGuild();
      const channel = createMockTextChannel({ name: 'general', guild, parent: null });
      const message = createMockMessage({ guild, channel });

      const result = extractDiscordEnvironment(message);

      expect(result.category).toBeUndefined();
    });
  });

  describe('Thread Channels', () => {
    it('should correctly identify a thread', () => {
      const guild = createMockGuild({ name: 'Test Server' });
      const parentChannel = createMockTextChannel({ id: 'parent-123', name: 'general', guild });
      const thread = createMockThreadChannel({
        id: 'thread-456',
        name: 'Discussion Thread',
        parent: parentChannel,
        guild,
      });
      const message = createMockThreadMessage({ channel: thread, guild });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('guild');
      expect(result.thread).toEqual({
        id: 'thread-456',
        name: 'Discussion Thread',
        parentChannel: {
          id: 'parent-123',
          name: 'general',
          type: 'text',
        },
      });
    });

    it('should set parent as main channel for threads', () => {
      const guild = createMockGuild();
      const parentChannel = createMockTextChannel({ id: 'parent-123', name: 'announcements', guild });
      const thread = createMockThreadChannel({
        name: 'Update Thread',
        parent: parentChannel,
        guild,
      });
      const message = createMockThreadMessage({ channel: thread, guild });

      const result = extractDiscordEnvironment(message);

      // Main channel should be the parent, not the thread
      expect(result.channel.id).toBe('parent-123');
      expect(result.channel.name).toBe('announcements');
    });

    it('should include category for thread parent channel', () => {
      const guild = createMockGuild();
      const category = createMockCategoryChannel({ id: 'cat-789', name: 'Support' });
      const parentChannel = createMockTextChannel({ name: 'help', guild, parent: category });
      const thread = createMockThreadChannel({
        name: 'Help Thread',
        parent: parentChannel,
        guild,
      });
      const message = createMockThreadMessage({ channel: thread, guild });

      const result = extractDiscordEnvironment(message);

      expect(result.category).toEqual({
        id: 'cat-789',
        name: 'Support',
      });
    });
  });

  describe('Edge Cases', () => {
    it('should fallback to DM for non-DM channel without guild', () => {
      const channel = createMockTextChannel({ type: ChannelType.GuildText });
      const message = createMockMessage({ channel, guild: null });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('dm');
      expect(result.channel.type).toBe('unknown');
      expect(result.channel.name).toBe('Unknown');
    });

    it('should handle channel without name property', () => {
      const guild = createMockGuild();
      const channel = createMockTextChannel({ guild });
      delete (channel as any).name; // Remove name property

      const message = createMockMessage({ guild, channel });
      const result = extractDiscordEnvironment(message);

      expect(result.channel.name).toBe('Unknown');
    });
  });
});

describe('formatEnvironmentForPrompt', () => {
  describe('DM Format', () => {
    it('should format DM environment correctly', () => {
      const context = {
        type: 'dm' as const,
        channel: {
          id: '123',
          name: 'Direct Message',
          type: 'dm',
        },
      };

      const result = formatEnvironmentForPrompt(context);

      expect(result).toBe('This conversation is taking place in a **Direct Message** (private one-on-one chat).');
    });
  });

  describe('Guild Format', () => {
    it('should format basic guild channel', () => {
      const context = {
        type: 'guild' as const,
        guild: {
          id: 'guild-123',
          name: 'Test Server',
        },
        channel: {
          id: 'channel-456',
          name: 'general',
          type: 'text',
        },
      };

      const result = formatEnvironmentForPrompt(context);

      expect(result).toContain('**Server**: Test Server');
      expect(result).toContain('**Channel**: #general (text)');
    });

    it('should include category when present', () => {
      const context = {
        type: 'guild' as const,
        guild: {
          id: 'guild-123',
          name: 'Test Server',
        },
        channel: {
          id: 'channel-456',
          name: 'chat',
          type: 'text',
        },
        category: {
          id: 'cat-789',
          name: 'Community',
        },
      };

      const result = formatEnvironmentForPrompt(context);

      expect(result).toContain('**Server**: Test Server');
      expect(result).toContain('**Category**: Community');
      expect(result).toContain('**Channel**: #chat (text)');
    });

    it('should include thread when present', () => {
      const context = {
        type: 'guild' as const,
        guild: {
          id: 'guild-123',
          name: 'Test Server',
        },
        channel: {
          id: 'channel-456',
          name: 'announcements',
          type: 'text',
        },
        thread: {
          id: 'thread-789',
          name: 'Update Discussion',
          parentChannel: {
            id: 'channel-456',
            name: 'announcements',
            type: 'text',
          },
        },
      };

      const result = formatEnvironmentForPrompt(context);

      expect(result).toContain('**Server**: Test Server');
      expect(result).toContain('**Channel**: #announcements (text)');
      expect(result).toContain('**Thread**: Update Discussion');
    });

    it('should format complete context with all fields', () => {
      const context = {
        type: 'guild' as const,
        guild: {
          id: 'guild-123',
          name: 'Amazing Server',
        },
        category: {
          id: 'cat-789',
          name: 'Staff Only',
        },
        channel: {
          id: 'channel-456',
          name: 'admin-chat',
          type: 'text',
        },
        thread: {
          id: 'thread-101',
          name: 'Planning Thread',
          parentChannel: {
            id: 'channel-456',
            name: 'admin-chat',
            type: 'text',
          },
        },
      };

      const result = formatEnvironmentForPrompt(context);

      expect(result).toContain('**Server**: Amazing Server');
      expect(result).toContain('**Category**: Staff Only');
      expect(result).toContain('**Channel**: #admin-chat (text)');
      expect(result).toContain('**Thread**: Planning Thread');
    });
  });

  describe('Format Structure', () => {
    it('should start with appropriate intro text for DM', () => {
      const context = {
        type: 'dm' as const,
        channel: { id: '123', name: 'Direct Message', type: 'dm' },
      };

      const result = formatEnvironmentForPrompt(context);

      expect(result).toMatch(/^This conversation is taking place in a \*\*Direct Message\*\*/);
    });

    it('should start with appropriate intro text for guild', () => {
      const context = {
        type: 'guild' as const,
        guild: { id: '123', name: 'Test' },
        channel: { id: '456', name: 'general', type: 'text' },
      };

      const result = formatEnvironmentForPrompt(context);

      expect(result).toMatch(/^This conversation is taking place in a Discord server:/);
    });
  });
});
