/**
 * Tests for Discord Context Utilities
 *
 * Tests the extraction and formatting of Discord environment context
 *
 * **Why @ts-nocheck**: Test override object literals (like `{ id: '123', name: 'foo' }`)
 * inherit Object.prototype methods (toString, valueOf) that conflict with Discord.js's
 * specialized type signatures. Adding @ts-expect-error to every mock factory call
 * (20+ locations) creates noise without value. The mock factories handle this correctly
 * at runtime with `as unknown as T`. Tests validate the behavior (17 passing tests).
 */

// @ts-nocheck - Object.prototype conflicts in test literals (see comment above)
import { describe, it, expect } from 'vitest';
import { ChannelType } from 'discord.js';
import { extractDiscordEnvironment } from './discordContext.js';
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
      const parentChannel = createMockTextChannel({
        id: 'parent-123',
        name: 'announcements',
        guild,
      });
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

  describe('Channel Type Identification', () => {
    it('should identify voice channels correctly', () => {
      const guild = createMockGuild({ name: 'Test Server' });
      const channel = createMockTextChannel({
        id: 'voice-123',
        name: 'General Voice',
        guild,
        type: ChannelType.GuildVoice,
      });
      const message = createMockMessage({ guild, channel });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('guild');
      expect(result.channel.type).toBe('voice');
    });

    it('should identify group DM channels correctly', () => {
      const channel = createMockTextChannel({
        id: 'group-dm-123',
        name: 'Group Chat',
        type: ChannelType.GroupDM,
      });
      const message = createMockMessage({ channel, guild: null });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('dm');
      expect(result.channel.type).toBe('unknown');
    });

    it('should identify announcement channels correctly', () => {
      const guild = createMockGuild({ name: 'Test Server' });
      const channel = createMockTextChannel({
        id: 'announce-123',
        name: 'announcements',
        guild,
        type: ChannelType.GuildAnnouncement,
      });
      const message = createMockMessage({ guild, channel });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('guild');
      expect(result.channel.type).toBe('announcement');
    });

    it('should identify forum channels correctly', () => {
      const guild = createMockGuild({ name: 'Test Server' });
      const channel = createMockTextChannel({
        id: 'forum-123',
        name: 'help-forum',
        guild,
        type: ChannelType.GuildForum,
      });
      const message = createMockMessage({ guild, channel });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('guild');
      expect(result.channel.type).toBe('forum');
    });

    it('should identify stage channels correctly', () => {
      const guild = createMockGuild({ name: 'Test Server' });
      const channel = createMockTextChannel({
        id: 'stage-123',
        name: 'Stage Channel',
        guild,
        type: ChannelType.GuildStageVoice,
      });
      const message = createMockMessage({ guild, channel });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('guild');
      expect(result.channel.type).toBe('stage');
    });

    it('should identify media channels correctly', () => {
      const guild = createMockGuild({ name: 'Test Server' });
      const channel = createMockTextChannel({
        id: 'media-123',
        name: 'media-gallery',
        guild,
        type: ChannelType.GuildMedia,
      });
      const message = createMockMessage({ guild, channel });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('guild');
      expect(result.channel.type).toBe('media');
    });

    it('should identify directory channels correctly', () => {
      const guild = createMockGuild({ name: 'Test Server' });
      const channel = createMockTextChannel({
        id: 'directory-123',
        name: 'Server Directory',
        guild,
        type: ChannelType.GuildDirectory,
      });
      const message = createMockMessage({ guild, channel });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('guild');
      expect(result.channel.type).toBe('directory');
    });

    it('should identify announcement threads correctly', () => {
      const guild = createMockGuild({ name: 'Test Server' });
      const parentChannel = createMockTextChannel({
        id: 'parent-123',
        name: 'announcements',
        guild,
        type: ChannelType.GuildAnnouncement,
      });
      const thread = createMockThreadChannel({
        id: 'thread-123',
        name: 'Discussion',
        parent: parentChannel,
        guild,
        type: ChannelType.AnnouncementThread,
      });
      const message = createMockThreadMessage({ channel: thread, guild });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('guild');
      expect(result.thread?.parentChannel.type).toBe('announcement');
    });

    it('should identify private threads correctly', () => {
      const guild = createMockGuild({ name: 'Test Server' });
      const parentChannel = createMockTextChannel({
        id: 'parent-123',
        name: 'private-channel',
        guild,
      });
      const thread = createMockThreadChannel({
        id: 'thread-123',
        name: 'Private Discussion',
        parent: parentChannel,
        guild,
        type: ChannelType.PrivateThread,
      });
      const message = createMockThreadMessage({ channel: thread, guild });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('guild');
      expect(result.thread).toBeDefined();
    });

    it('should handle unknown channel types with default case', () => {
      const guild = createMockGuild({ name: 'Test Server' });
      const channel = createMockTextChannel({
        id: 'unknown-123',
        name: 'unknown-channel',
        guild,
        type: 999 as ChannelType, // Invalid channel type
      });
      const message = createMockMessage({ guild, channel });

      const result = extractDiscordEnvironment(message);

      expect(result.type).toBe('guild');
      expect(result.channel.type).toBe('unknown');
    });
  });
});
