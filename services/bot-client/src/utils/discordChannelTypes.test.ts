/**
 * Tests for Discord Channel Type Utilities
 */

import { describe, expect, it } from 'vitest';
import { ChannelType } from 'discord.js';
import {
  isThreadChannel,
  getThreadParent,
  getThreadParentId,
  isTextBasedMessageChannel,
} from './discordChannelTypes.js';

describe('discordChannelTypes', () => {
  describe('isThreadChannel', () => {
    it('returns false for null', () => {
      expect(isThreadChannel(null)).toBe(false);
    });

    it('returns true for PublicThread', () => {
      const channel = { type: ChannelType.PublicThread } as never;
      expect(isThreadChannel(channel)).toBe(true);
    });

    it('returns true for PrivateThread', () => {
      const channel = { type: ChannelType.PrivateThread } as never;
      expect(isThreadChannel(channel)).toBe(true);
    });

    it('returns true for AnnouncementThread', () => {
      const channel = { type: ChannelType.AnnouncementThread } as never;
      expect(isThreadChannel(channel)).toBe(true);
    });

    it('returns false for GuildText', () => {
      const channel = { type: ChannelType.GuildText } as never;
      expect(isThreadChannel(channel)).toBe(false);
    });

    it('returns false for DM', () => {
      const channel = { type: ChannelType.DM } as never;
      expect(isThreadChannel(channel)).toBe(false);
    });
  });

  describe('getThreadParent', () => {
    it('returns null for null channel', () => {
      expect(getThreadParent(null)).toBeNull();
    });

    it('returns null for non-thread channel', () => {
      const channel = { type: ChannelType.GuildText } as never;
      expect(getThreadParent(channel)).toBeNull();
    });

    it('returns parent for thread channel', () => {
      const mockParent = { id: 'parent-123', type: ChannelType.GuildText };
      const channel = {
        type: ChannelType.PublicThread,
        parent: mockParent,
      } as never;
      expect(getThreadParent(channel)).toBe(mockParent);
    });

    it('returns null when thread has no parent cached', () => {
      const channel = {
        type: ChannelType.PublicThread,
        parent: null,
      } as never;
      expect(getThreadParent(channel)).toBeNull();
    });
  });

  describe('getThreadParentId', () => {
    it('returns null for null channel', () => {
      expect(getThreadParentId(null)).toBeNull();
    });

    it('returns null for non-thread channel', () => {
      const channel = { type: ChannelType.GuildText } as never;
      expect(getThreadParentId(channel)).toBeNull();
    });

    it('returns parentId for PublicThread', () => {
      const channel = {
        type: ChannelType.PublicThread,
        parentId: 'parent-123',
        parent: null,
      } as never;
      expect(getThreadParentId(channel)).toBe('parent-123');
    });

    it('returns parentId for PrivateThread', () => {
      const channel = {
        type: ChannelType.PrivateThread,
        parentId: 'parent-456',
        parent: null,
      } as never;
      expect(getThreadParentId(channel)).toBe('parent-456');
    });

    it('returns parentId for AnnouncementThread', () => {
      const channel = {
        type: ChannelType.AnnouncementThread,
        parentId: 'parent-789',
        parent: null,
      } as never;
      expect(getThreadParentId(channel)).toBe('parent-789');
    });

    it('returns null when thread has null parentId', () => {
      const channel = {
        type: ChannelType.PublicThread,
        parentId: null,
        parent: null,
      } as never;
      expect(getThreadParentId(channel)).toBeNull();
    });
  });

  describe('isTextBasedMessageChannel', () => {
    it('returns false for null', () => {
      expect(isTextBasedMessageChannel(null)).toBe(false);
    });

    it('returns true for DM', () => {
      const channel = { type: ChannelType.DM } as never;
      expect(isTextBasedMessageChannel(channel)).toBe(true);
    });

    it('returns true for GuildText', () => {
      const channel = { type: ChannelType.GuildText } as never;
      expect(isTextBasedMessageChannel(channel)).toBe(true);
    });

    it('returns true for GuildNews', () => {
      const channel = { type: ChannelType.GuildNews } as never;
      expect(isTextBasedMessageChannel(channel)).toBe(true);
    });

    it('returns true for PublicThread', () => {
      const channel = { type: ChannelType.PublicThread } as never;
      expect(isTextBasedMessageChannel(channel)).toBe(true);
    });

    it('returns true for PrivateThread', () => {
      const channel = { type: ChannelType.PrivateThread } as never;
      expect(isTextBasedMessageChannel(channel)).toBe(true);
    });

    it('returns true for AnnouncementThread', () => {
      const channel = { type: ChannelType.AnnouncementThread } as never;
      expect(isTextBasedMessageChannel(channel)).toBe(true);
    });

    it('returns false for GuildVoice', () => {
      const channel = { type: ChannelType.GuildVoice } as never;
      expect(isTextBasedMessageChannel(channel)).toBe(false);
    });

    it('returns false for GuildCategory', () => {
      const channel = { type: ChannelType.GuildCategory } as never;
      expect(isTextBasedMessageChannel(channel)).toBe(false);
    });
  });
});
