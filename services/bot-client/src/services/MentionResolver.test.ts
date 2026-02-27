/**
 * Tests for MentionResolver
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MentionResolver } from './MentionResolver.js';
import type { PrismaClient } from '@tzurot/common-types';
import type { Collection, User } from 'discord.js';

// Valid Discord snowflake IDs for testing (17-19 digit numeric strings)
const VALID_CHANNEL_ID = '123456789012345678';
const VALID_CHANNEL_ID_2 = '234567890123456789';
const VALID_ROLE_ID = '345678901234567890';
const VALID_ROLE_ID_2 = '456789012345678901';
const VALID_USER_ID = '567890123456789012';

// Mock PersonaResolver
const mockPersonaResolver = {
  resolve: vi.fn(),
  resolveForMemory: vi.fn(),
  getPersonaContentForPrompt: vi.fn(),
  invalidateUserCache: vi.fn(),
  clearCache: vi.fn(),
  stopCleanup: vi.fn(),
};

// Mock dependencies - use synchronous mock to ensure DISCORD_MENTIONS is available at module load
vi.mock('@tzurot/common-types', () => ({
  // Constants must be provided synchronously
  DISCORD_MENTIONS: {
    USER_PATTERN: '<@!?(\\d+)>',
    CHANNEL_PATTERN: '<#(\\d+)>',
    ROLE_PATTERN: '<@&(\\d+)>',
    MAX_PER_MESSAGE: 10,
    MAX_CHANNELS_PER_MESSAGE: 5,
    MAX_ROLES_PER_MESSAGE: 5,
    UNKNOWN_CHANNEL_PLACEHOLDER: '#unknown-channel',
    UNKNOWN_ROLE_PLACEHOLDER: '@unknown-role',
  },
  UserService: class {
    getOrCreateUser = vi.fn();
    getPersonaName = vi.fn();
  },
  createLogger: () => ({
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
  // Validation helper that filters to 17-19 digit numeric strings
  isValidDiscordId: (id: string) => /^\d{17,19}$/.test(id),
}));

// Import after mocks
import { UserService } from '@tzurot/common-types';

describe('MentionResolver', () => {
  let resolver: MentionResolver;
  let mockPrisma: PrismaClient;
  let mockUserService: UserService;
  let mockMentionedUsers: Map<string, User>;

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock Prisma client
    mockPrisma = {
      user: {
        findUnique: vi.fn(),
      },
    } as unknown as PrismaClient;

    // Create resolver instance with mock PersonaResolver
    resolver = new MentionResolver(mockPrisma, mockPersonaResolver as any);

    // Get service instance to access mocks
    mockUserService = (resolver as any).userService;

    // Create mock mentioned users Collection
    mockMentionedUsers = new Map();

    // Default mock for PersonaResolver.resolve
    mockPersonaResolver.resolve.mockResolvedValue({
      config: {
        personaId: 'persona-123',
        preferredName: 'Test Persona',
        pronouns: null,
        content: '',
      },
      source: 'user-default',
    });
  });

  /**
   * Helper to create a mock Discord User
   */
  function createMockUser(id: string, username: string, globalName: string | null = null): User {
    return {
      id,
      username,
      globalName,
    } as User;
  }

  describe('resolveMentions', () => {
    it('should return unchanged content when no mentions present', async () => {
      const result = await resolver.resolveMentions(
        'Hello, this is a message without mentions',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      expect(result.processedContent).toBe('Hello, this is a message without mentions');
      expect(result.mentionedUsers).toEqual([]);
    });

    it('should resolve a single mention when Discord user is available', async () => {
      const mockUser = createMockUser('123456', 'testuser', 'Test User');
      mockMentionedUsers.set('123456', mockUser);

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      // PersonaResolver.resolve mock returns 'persona-123' and 'Test Persona' by default

      const result = await resolver.resolveMentions(
        'Hey <@123456>, how are you?',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      expect(result.processedContent).toBe('Hey @Test Persona, how are you?');
      expect(result.mentionedUsers).toHaveLength(1);
      expect(result.mentionedUsers[0]).toEqual({
        discordId: '123456',
        userId: 'user-uuid-123',
        personaId: 'persona-123',
        personaName: 'Test Persona',
      });

      expect(mockUserService.getOrCreateUser).toHaveBeenCalledWith(
        '123456',
        'testuser',
        'Test User',
        undefined, // bio
        undefined // isBot
      );
      // PersonaResolver uses Discord ID directly
      expect(mockPersonaResolver.resolve).toHaveBeenCalledWith(
        '123456', // Discord ID
        'personality-123'
      );
    });

    it('should handle nickname mention format with exclamation mark', async () => {
      const mockUser = createMockUser('123456', 'testuser', 'Test User');
      mockMentionedUsers.set('123456', mockUser);

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      // PersonaResolver.resolve mock returns 'persona-123' and 'Test Persona' by default

      const result = await resolver.resolveMentions(
        'Hey <@!123456>, how are you?',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      expect(result.processedContent).toBe('Hey @Test Persona, how are you?');
      expect(result.mentionedUsers).toHaveLength(1);
    });

    it('should deduplicate multiple mentions of the same user', async () => {
      const mockUser = createMockUser('123456', 'testuser', 'Test User');
      mockMentionedUsers.set('123456', mockUser);

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      // PersonaResolver.resolve mock returns 'persona-123' and 'Test Persona' by default

      const result = await resolver.resolveMentions(
        'Hey <@123456>! I was just talking to <@123456> about you, <@123456>',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      expect(result.processedContent).toBe(
        'Hey @Test Persona! I was just talking to @Test Persona about you, @Test Persona'
      );
      expect(result.mentionedUsers).toHaveLength(1); // Only one entry

      // Service should only be called once per unique user
      expect(mockUserService.getOrCreateUser).toHaveBeenCalledTimes(1);
    });

    it('should resolve multiple different users', async () => {
      const mockUser1 = createMockUser('111111', 'alice', 'Alice');
      const mockUser2 = createMockUser('222222', 'bob', 'Bob');
      mockMentionedUsers.set('111111', mockUser1);
      mockMentionedUsers.set('222222', mockUser2);

      vi.mocked(mockUserService.getOrCreateUser)
        .mockResolvedValueOnce('alice-uuid')
        .mockResolvedValueOnce('bob-uuid');
      mockPersonaResolver.resolve
        .mockResolvedValueOnce({
          config: {
            personaId: 'alice-persona',
            preferredName: 'AlicePersona',
            pronouns: null,
            content: '',
          },
          source: 'user-default',
        })
        .mockResolvedValueOnce({
          config: {
            personaId: 'bob-persona',
            preferredName: 'BobPersona',
            pronouns: null,
            content: '',
          },
          source: 'user-default',
        });

      const result = await resolver.resolveMentions(
        'Hey <@111111> and <@222222>, lets chat!',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      expect(result.processedContent).toBe('Hey @AlicePersona and @BobPersona, lets chat!');
      expect(result.mentionedUsers).toHaveLength(2);
      expect(result.mentionedUsers[0].personaName).toBe('AlicePersona');
      expect(result.mentionedUsers[1].personaName).toBe('BobPersona');
    });

    it('should fall back to database lookup when user not in mentions collection', async () => {
      // User not in Discord mentions, but exists in our database
      const mockDbUser = { id: 'db-user-uuid', username: 'existinguser' };
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue(mockDbUser as any);
      mockPersonaResolver.resolve.mockResolvedValue({
        config: {
          personaId: 'db-persona-uuid',
          preferredName: 'ExistingPersona',
          pronouns: null,
          content: '',
        },
        source: 'user-default',
      });

      const result = await resolver.resolveMentions(
        'Talking about <@999999> who is not online',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      expect(result.processedContent).toBe('Talking about @ExistingPersona who is not online');
      expect(result.mentionedUsers).toHaveLength(1);
      expect(result.mentionedUsers[0]).toEqual({
        discordId: '999999',
        userId: 'db-user-uuid',
        personaId: 'db-persona-uuid',
        personaName: 'ExistingPersona',
      });

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { discordId: '999999' },
        select: { id: true, username: true },
      });
    });

    it('should leave mention as-is when user cannot be resolved', async () => {
      // User not in Discord mentions AND not in database
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue(null);

      const result = await resolver.resolveMentions(
        'Talking about <@999999> who is unknown',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      expect(result.processedContent).toBe('Talking about <@999999> who is unknown');
      expect(result.mentionedUsers).toEqual([]);
    });

    it('should use username as fallback when globalName is null', async () => {
      const mockUser = createMockUser('123456', 'testuser', null);
      mockMentionedUsers.set('123456', mockUser);

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      mockPersonaResolver.resolve.mockResolvedValue({
        config: {
          personaId: 'persona-uuid-123',
          preferredName: null,
          pronouns: null,
          content: '',
        },
        source: 'user-default',
      });

      const result = await resolver.resolveMentions(
        'Hey <@123456>!',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      // Should fall back to the display name (username in this case)
      expect(result.processedContent).toBe('Hey @testuser!');
      expect(result.mentionedUsers[0].personaName).toBe('testuser');

      expect(mockUserService.getOrCreateUser).toHaveBeenCalledWith(
        '123456',
        'testuser',
        'testuser', // Falls back to username
        undefined, // bio
        undefined // isBot
      );
    });

    it('should handle error in user service gracefully', async () => {
      const mockUser = createMockUser('123456', 'testuser', 'Test User');
      mockMentionedUsers.set('123456', mockUser);

      vi.mocked(mockUserService.getOrCreateUser).mockRejectedValue(new Error('Database error'));

      const result = await resolver.resolveMentions(
        'Hey <@123456>!',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      // Should leave mention as-is on error
      expect(result.processedContent).toBe('Hey <@123456>!');
      expect(result.mentionedUsers).toEqual([]);
    });

    it('should handle error in database lookup gracefully', async () => {
      vi.mocked(mockPrisma.user.findUnique).mockRejectedValue(new Error('Database error'));

      const result = await resolver.resolveMentions(
        'Hey <@123456>!',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      // Should leave mention as-is on error
      expect(result.processedContent).toBe('Hey <@123456>!');
      expect(result.mentionedUsers).toEqual([]);
    });

    it('should handle mixed resolved and unresolved mentions', async () => {
      const mockUser = createMockUser('111111', 'alice', 'Alice');
      mockMentionedUsers.set('111111', mockUser);

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('alice-uuid');
      mockPersonaResolver.resolve.mockResolvedValue({
        config: {
          personaId: 'alice-persona',
          preferredName: 'AlicePersona',
          pronouns: null,
          content: '',
        },
        source: 'user-default',
      });
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue(null);

      const result = await resolver.resolveMentions(
        'Hey <@111111> and <@999999>, lets chat!',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      // Alice resolved, unknown user left as-is
      expect(result.processedContent).toBe('Hey @AlicePersona and <@999999>, lets chat!');
      expect(result.mentionedUsers).toHaveLength(1);
      expect(result.mentionedUsers[0].personaName).toBe('AlicePersona');
    });

    it('should use database username as fallback when persona name is null', async () => {
      vi.mocked(mockPrisma.user.findUnique).mockResolvedValue({
        id: 'db-user-uuid',
        username: 'dbusername',
      } as any);
      mockPersonaResolver.resolve.mockResolvedValue({
        config: {
          personaId: 'persona-uuid',
          preferredName: null,
          pronouns: null,
          content: '',
        },
        source: 'user-default',
      });

      const result = await resolver.resolveMentions(
        'Hey <@123456>!',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      expect(result.processedContent).toBe('Hey @dbusername!');
      expect(result.mentionedUsers[0].personaName).toBe('dbusername');
    });

    it('should handle both mention formats in the same message', async () => {
      // Tests that both <@123456> and <@!123456> are replaced for the same user
      const mockUser = createMockUser('123456', 'testuser', 'Test User');
      mockMentionedUsers.set('123456', mockUser);

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('user-uuid-123');
      // PersonaResolver.resolve mock returns 'persona-123' and 'Test Persona' by default

      const result = await resolver.resolveMentions(
        'Hey <@123456>! I was talking to <@!123456> about you, <@123456>',
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      // All mention formats should be replaced
      expect(result.processedContent).toBe(
        'Hey @Test Persona! I was talking to @Test Persona about you, @Test Persona'
      );
      // Only one user entry (deduplicated)
      expect(result.mentionedUsers).toHaveLength(1);
      expect(result.mentionedUsers[0].personaName).toBe('Test Persona');

      // Service should only be called once (deduplication)
      expect(mockUserService.getOrCreateUser).toHaveBeenCalledTimes(1);
    });

    it('should respect max mentions limit for DoS prevention', async () => {
      // Create 15 different users (more than the limit of 10)
      for (let i = 1; i <= 15; i++) {
        const mockUser = createMockUser(`${i}`, `user${i}`, `User ${i}`);
        mockMentionedUsers.set(`${i}`, mockUser);
      }

      vi.mocked(mockUserService.getOrCreateUser).mockImplementation(async discordId => {
        return `uuid-${discordId}`;
      });
      mockPersonaResolver.resolve.mockImplementation(async (discordId: string) => ({
        config: {
          personaId: `persona-${discordId}`,
          preferredName: `Persona${discordId}`,
          pronouns: null,
          content: '',
        },
        source: 'user-default' as const,
      }));

      // Build a message with 15 mentions
      const mentions = Array.from({ length: 15 }, (_, i) => `<@${i + 1}>`).join(' ');
      const result = await resolver.resolveMentions(
        `Hello ${mentions}`,
        mockMentionedUsers as Collection<string, User>,
        'personality-123'
      );

      // Should only process MAX_PER_MESSAGE (10) users
      expect(result.mentionedUsers.length).toBeLessThanOrEqual(10);
      // User service should only be called up to 10 times
      expect(mockUserService.getOrCreateUser).toHaveBeenCalledTimes(10);
    });
  });

  describe('resolveChannelMentions', () => {
    /**
     * Helper to create a mock Guild with channels
     */
    function createMockGuild(channels: Map<string, { name: string; topic?: string }>) {
      return {
        id: 'guild-123',
        channels: {
          cache: {
            get: (id: string) => {
              const channel = channels.get(id);
              if (!channel) return undefined;
              return {
                name: channel.name,
                topic: channel.topic,
              };
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
      // Use a valid snowflake ID that's not in the cache
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
    /**
     * Helper to create a mock Guild with roles
     */
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
      // Use a valid snowflake ID that's not in the cache
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
    /**
     * Helper to create a mock Message with all mention types
     */
    function createMockMessage(
      _content: string,
      users: Map<string, User>,
      channels: Map<string, { name: string; topic?: string }>,
      roles: Map<string, { name: string; mentionable: boolean }>
    ) {
      return {
        mentions: {
          users: users as Collection<string, User>,
        },
        guild: {
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
        },
      } as any;
    }

    it('should resolve all mention types in a single message', async () => {
      const mockUser = createMockUser(VALID_USER_ID, 'alice', 'Alice');
      const mockUsers = new Map([[VALID_USER_ID, mockUser]]);
      const mockChannels = new Map([[VALID_CHANNEL_ID, { name: 'general' }]]);
      const mockRoles = new Map([[VALID_ROLE_ID, { name: 'Mods', mentionable: true }]]);

      const mockMessage = createMockMessage(
        `Hey <@${VALID_USER_ID}>! Check <#${VALID_CHANNEL_ID}> or ask <@&${VALID_ROLE_ID}>`,
        mockUsers,
        mockChannels,
        mockRoles
      );

      vi.mocked(mockUserService.getOrCreateUser).mockResolvedValue('alice-uuid');
      mockPersonaResolver.resolve.mockResolvedValue({
        config: {
          personaId: 'alice-persona',
          preferredName: 'AlicePersona',
          pronouns: null,
          content: '',
        },
        source: 'user-default',
      });

      const result = await resolver.resolveAllMentions(
        `Hey <@${VALID_USER_ID}>! Check <#${VALID_CHANNEL_ID}> or ask <@&${VALID_ROLE_ID}>`,
        mockMessage,
        'personality-123'
      );

      expect(result.processedContent).toBe('Hey @AlicePersona! Check #general or ask @Mods');
      expect(result.mentionedUsers).toHaveLength(1);
      expect(result.mentionedChannels).toHaveLength(1);
      expect(result.mentionedRoles).toHaveLength(1);
    });

    it('should handle message with no mentions', async () => {
      const mockMessage = createMockMessage('Hello world', new Map(), new Map(), new Map());

      const result = await resolver.resolveAllMentions(
        'Hello world',
        mockMessage,
        'personality-123'
      );

      expect(result.processedContent).toBe('Hello world');
      expect(result.mentionedUsers).toEqual([]);
      expect(result.mentionedChannels).toEqual([]);
      expect(result.mentionedRoles).toEqual([]);
    });
  });
});
