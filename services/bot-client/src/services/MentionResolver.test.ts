/**
 * Tests for MentionResolver
 *
 * MentionResolver is now a stateless guild-cache rewriter: channel + role
 * mentions only. User→persona resolution moved worker-side (the worker
 * re-derives it from the envelope and overwrites the message content), so user
 * mentions are left RAW here. The real `rewriteChannelMentions`/`rewriteRoleMentions`
 * kernels run unmocked, so these stay genuine behavior tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MentionResolver } from './MentionResolver.js';

// Valid Discord snowflake IDs for testing (17-19 digit numeric strings)
const VALID_CHANNEL_ID = '123456789012345678';
const VALID_CHANNEL_ID_2 = '234567890123456789';
const VALID_ROLE_ID = '345678901234567890';
const VALID_ROLE_ID_2 = '456789012345678901';
const VALID_USER_ID = '567890123456789012';

describe('MentionResolver', () => {
  let resolver: MentionResolver;

  beforeEach(() => {
    resolver = new MentionResolver();
  });

  describe('resolveChannelMentions', () => {
    function createMockGuild(channels: Map<string, { name: string; topic?: string }>) {
      return {
        id: 'guild-123',
        channels: {
          cache: {
            get: (id: string) => {
              const channel = channels.get(id);
              if (!channel) return undefined;
              return { name: channel.name, topic: channel.topic };
            },
          },
        },
      } as any;
    }

    it('should return unchanged content when no channel mentions present', () => {
      const result = resolver.resolveChannelMentions('Hello, this is a message', null);

      expect(result.processedContent).toBe('Hello, this is a message');
      expect(result.mentionedChannels).toEqual([]);
    });

    it('should resolve a single channel mention', () => {
      const mockChannels = new Map([
        [VALID_CHANNEL_ID, { name: 'general', topic: 'General discussion' }],
      ]);
      const mockGuild = createMockGuild(mockChannels);

      const result = resolver.resolveChannelMentions(
        `Check out <#${VALID_CHANNEL_ID}> for more info`,
        mockGuild
      );

      expect(result.processedContent).toBe('Check out #general for more info');
      expect(result.mentionedChannels).toHaveLength(1);
      expect(result.mentionedChannels[0]).toEqual({
        channelId: VALID_CHANNEL_ID,
        channelName: 'general',
        topic: 'General discussion',
        guildId: 'guild-123',
      });
    });

    it('should resolve multiple channel mentions', () => {
      const mockChannels = new Map([
        [VALID_CHANNEL_ID, { name: 'announcements' }],
        [VALID_CHANNEL_ID_2, { name: 'gaming', topic: 'Game talk' }],
      ]);
      const mockGuild = createMockGuild(mockChannels);

      const result = resolver.resolveChannelMentions(
        `See <#${VALID_CHANNEL_ID}> and <#${VALID_CHANNEL_ID_2}>`,
        mockGuild
      );

      expect(result.processedContent).toBe('See #announcements and #gaming');
      expect(result.mentionedChannels).toHaveLength(2);
    });

    it('should handle unknown channel with placeholder', () => {
      const mockGuild = createMockGuild(new Map());
      const unknownChannelId = '999888777666555444';

      const result = resolver.resolveChannelMentions(`Check out <#${unknownChannelId}>`, mockGuild);

      expect(result.processedContent).toBe('Check out #unknown-channel');
      expect(result.mentionedChannels).toEqual([]);
    });

    it('should handle null guild gracefully', () => {
      const result = resolver.resolveChannelMentions(`Check out <#${VALID_CHANNEL_ID}>`, null);

      expect(result.processedContent).toBe('Check out #unknown-channel');
      expect(result.mentionedChannels).toEqual([]);
    });

    it('should deduplicate repeated channel mentions', () => {
      const mockChannels = new Map([[VALID_CHANNEL_ID, { name: 'general' }]]);
      const mockGuild = createMockGuild(mockChannels);

      const result = resolver.resolveChannelMentions(
        `<#${VALID_CHANNEL_ID}> is great! Come to <#${VALID_CHANNEL_ID}>!`,
        mockGuild
      );

      expect(result.processedContent).toBe('#general is great! Come to #general!');
      expect(result.mentionedChannels).toHaveLength(1);
    });
  });

  describe('resolveRoleMentions', () => {
    function createMockGuild(roles: Map<string, { name: string; mentionable: boolean }>) {
      return {
        id: 'guild-123',
        roles: {
          cache: {
            get: (id: string) => roles.get(id),
          },
        },
      } as any;
    }

    it('should return unchanged content when no role mentions present', () => {
      const result = resolver.resolveRoleMentions('Hello everyone', null);

      expect(result.processedContent).toBe('Hello everyone');
      expect(result.mentionedRoles).toEqual([]);
    });

    it('should resolve a single role mention', () => {
      const mockRoles = new Map([[VALID_ROLE_ID, { name: 'Moderators', mentionable: true }]]);
      const mockGuild = createMockGuild(mockRoles);

      const result = resolver.resolveRoleMentions(
        `Hey <@&${VALID_ROLE_ID}>, we need help!`,
        mockGuild
      );

      expect(result.processedContent).toBe('Hey @Moderators, we need help!');
      expect(result.mentionedRoles).toHaveLength(1);
      expect(result.mentionedRoles[0]).toEqual({
        roleId: VALID_ROLE_ID,
        roleName: 'Moderators',
        mentionable: true,
      });
    });

    it('should resolve multiple role mentions', () => {
      const mockRoles = new Map([
        [VALID_ROLE_ID, { name: 'Admin', mentionable: false }],
        [VALID_ROLE_ID_2, { name: 'Developer', mentionable: true }],
      ]);
      const mockGuild = createMockGuild(mockRoles);

      const result = resolver.resolveRoleMentions(
        `<@&${VALID_ROLE_ID}> and <@&${VALID_ROLE_ID_2}> please review`,
        mockGuild
      );

      expect(result.processedContent).toBe('@Admin and @Developer please review');
      expect(result.mentionedRoles).toHaveLength(2);
    });

    it('should handle unknown role with placeholder', () => {
      const mockGuild = createMockGuild(new Map());
      const unknownRoleId = '888777666555444333';

      const result = resolver.resolveRoleMentions(`Hey <@&${unknownRoleId}>!`, mockGuild);

      expect(result.processedContent).toBe('Hey @unknown-role!');
      expect(result.mentionedRoles).toEqual([]);
    });

    it('should handle null guild gracefully', () => {
      const result = resolver.resolveRoleMentions(`Hey <@&${VALID_ROLE_ID}>!`, null);

      expect(result.processedContent).toBe('Hey @unknown-role!');
      expect(result.mentionedRoles).toEqual([]);
    });
  });

  describe('resolveAllMentions', () => {
    function createMockGuild(
      channels: Map<string, { name: string; topic?: string }>,
      roles: Map<string, { name: string; mentionable: boolean }>
    ) {
      return {
        id: 'guild-123',
        channels: {
          cache: {
            get: (id: string) => {
              const channel = channels.get(id);
              if (!channel) return undefined;
              return { name: channel.name, topic: channel.topic };
            },
          },
        },
        roles: {
          cache: {
            get: (id: string) => roles.get(id),
          },
        },
      } as any;
    }

    it('rewrites channel + role mentions but leaves USER mentions RAW (worker re-derives them)', () => {
      const mockChannels = new Map([[VALID_CHANNEL_ID, { name: 'general' }]]);
      const mockRoles = new Map([[VALID_ROLE_ID, { name: 'Mods', mentionable: true }]]);
      const guild = createMockGuild(mockChannels, mockRoles);

      const result = resolver.resolveAllMentions(
        `Hey <@${VALID_USER_ID}>! Check <#${VALID_CHANNEL_ID}> or ask <@&${VALID_ROLE_ID}>`,
        guild
      );

      // The user mention is preserved verbatim — the worker rewrites it to a
      // persona name from rawMentionedUsers. Channel + role are rewritten here.
      expect(result.processedContent).toBe(`Hey <@${VALID_USER_ID}>! Check #general or ask @Mods`);
      expect(result.mentionedChannels).toHaveLength(1);
      expect(result.mentionedRoles).toHaveLength(1);
    });

    it('should handle content with no mentions', () => {
      const guild = createMockGuild(new Map(), new Map());

      const result = resolver.resolveAllMentions('Hello world', guild);

      expect(result.processedContent).toBe('Hello world');
      expect(result.mentionedChannels).toEqual([]);
      expect(result.mentionedRoles).toEqual([]);
    });

    it('handles a null guild (DM) — channel/role mentions degrade to placeholders', () => {
      const result = resolver.resolveAllMentions(
        `Check <#${VALID_CHANNEL_ID}> and <@&${VALID_ROLE_ID}>`,
        null
      );

      expect(result.processedContent).toBe('Check #unknown-channel and @unknown-role');
      expect(result.mentionedChannels).toEqual([]);
      expect(result.mentionedRoles).toEqual([]);
    });
  });
});
