/**
 * Tests for ParticipantContextCollector
 *
 * Unit tests for guild info extraction and reactor collection functions.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  extractGuildInfo,
  limitParticipants,
  collectReactorUsers,
} from './ParticipantContextCollector.js';
import type { Message, GuildMember, Role, Collection } from 'discord.js';
import { MESSAGE_LIMITS, type MessageReaction } from '@tzurot/common-types';

/**
 * Create a mock role for testing
 */
function createMockRole(overrides: { id?: string; name?: string; position?: number }): Role {
  return {
    id: overrides.id ?? 'role-123',
    name: overrides.name ?? 'TestRole',
    position: overrides.position ?? 1,
  } as unknown as Role;
}

/**
 * Create a mock role collection
 */
function createMockRoleCache(roles: Role[], everyoneRoleId?: string): Collection<string, Role> {
  const cache = new Map<string, Role>();
  for (const role of roles) {
    cache.set(role.id, role);
  }
  return {
    values: () => cache.values(),
    // Make it iterable
    [Symbol.iterator]: () => cache.values(),
  } as unknown as Collection<string, Role>;
}

describe('ParticipantContextCollector', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractGuildInfo', () => {
    it('should return empty roles when no member present', () => {
      const msg = {
        member: null,
        guild: { id: 'guild-123' },
      } as unknown as Message;

      const result = extractGuildInfo(msg);

      expect(result).toEqual({ roles: [] });
    });

    it('should extract roles sorted by position (highest first)', () => {
      const roles = [
        createMockRole({ id: 'role-1', name: 'Low', position: 1 }),
        createMockRole({ id: 'role-3', name: 'High', position: 3 }),
        createMockRole({ id: 'role-2', name: 'Mid', position: 2 }),
      ];

      const msg = {
        member: {
          id: 'member-123',
          roles: { cache: createMockRoleCache(roles) },
          displayHexColor: '#FF5500',
          joinedAt: new Date('2024-01-15T10:30:00Z'),
        } as unknown as GuildMember,
        guild: { id: 'guild-123' },
      } as unknown as Message;

      const result = extractGuildInfo(msg);

      expect(result.roles).toEqual(['High', 'Mid', 'Low']);
    });

    it('should exclude @everyone role', () => {
      const guildId = 'guild-123';
      const roles = [
        createMockRole({ id: 'role-1', name: 'Member', position: 1 }),
        createMockRole({ id: guildId, name: '@everyone', position: 0 }), // @everyone has same ID as guild
      ];

      const msg = {
        member: {
          id: 'member-123',
          roles: { cache: createMockRoleCache(roles) },
          displayHexColor: '#000000',
          joinedAt: null,
        } as unknown as GuildMember,
        guild: { id: guildId },
      } as unknown as Message;

      const result = extractGuildInfo(msg);

      expect(result.roles).toEqual(['Member']);
      expect(result.roles).not.toContain('@everyone');
    });

    it('should limit roles to MAX_GUILD_ROLES', () => {
      const roles = Array.from({ length: 10 }, (_, i) =>
        createMockRole({ id: `role-${i}`, name: `Role${i}`, position: i })
      );

      const msg = {
        member: {
          id: 'member-123',
          roles: { cache: createMockRoleCache(roles) },
          displayHexColor: '#000000',
          joinedAt: null,
        } as unknown as GuildMember,
        guild: { id: 'guild-123' },
      } as unknown as Message;

      const result = extractGuildInfo(msg);

      expect(result.roles.length).toBeLessThanOrEqual(MESSAGE_LIMITS.MAX_GUILD_ROLES);
    });

    it('should include displayColor when not black', () => {
      const msg = {
        member: {
          id: 'member-123',
          roles: { cache: createMockRoleCache([]) },
          displayHexColor: '#FF5500',
          joinedAt: null,
        } as unknown as GuildMember,
        guild: { id: 'guild-123' },
      } as unknown as Message;

      const result = extractGuildInfo(msg);

      expect(result.displayColor).toBe('#FF5500');
    });

    it('should not include displayColor when black (transparent)', () => {
      const msg = {
        member: {
          id: 'member-123',
          roles: { cache: createMockRoleCache([]) },
          displayHexColor: '#000000',
          joinedAt: null,
        } as unknown as GuildMember,
        guild: { id: 'guild-123' },
      } as unknown as Message;

      const result = extractGuildInfo(msg);

      expect(result.displayColor).toBeUndefined();
    });

    it('should include joinedAt as ISO string', () => {
      const joinDate = new Date('2024-06-15T14:30:00Z');
      const msg = {
        member: {
          id: 'member-123',
          roles: { cache: createMockRoleCache([]) },
          displayHexColor: '#000000',
          joinedAt: joinDate,
        } as unknown as GuildMember,
        guild: { id: 'guild-123' },
      } as unknown as Message;

      const result = extractGuildInfo(msg);

      expect(result.joinedAt).toBe('2024-06-15T14:30:00.000Z');
    });
  });

  describe('limitParticipants', () => {
    it('should return unchanged when under limit', () => {
      const participants = {
        'user-1': { roles: ['Admin'] },
        'user-2': { roles: ['Member'] },
      };

      const result = limitParticipants(participants);

      expect(result).toEqual(participants);
    });

    it('should keep only most recent N participants when over limit', () => {
      // Create more participants than the limit
      const participants: Record<string, { roles: string[] }> = {};
      const count = MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT_PARTICIPANTS + 5;
      for (let i = 0; i < count; i++) {
        participants[`user-${i}`] = { roles: [`Role${i}`] };
      }

      const result = limitParticipants(participants);

      expect(Object.keys(result).length).toBe(MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT_PARTICIPANTS);
      // Should keep the LAST N entries (most recent)
      expect(Object.keys(result)[0]).toBe(`user-5`);
    });

    it('should handle exactly at limit', () => {
      const participants: Record<string, { roles: string[] }> = {};
      for (let i = 0; i < MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT_PARTICIPANTS; i++) {
        participants[`user-${i}`] = { roles: [] };
      }

      const result = limitParticipants(participants);

      expect(Object.keys(result).length).toBe(MESSAGE_LIMITS.MAX_EXTENDED_CONTEXT_PARTICIPANTS);
    });
  });

  describe('collectReactorUsers', () => {
    it('should collect unique reactor users from reactions', () => {
      const reactions: MessageReaction[] = [
        {
          emoji: '👍',
          isCustom: false,
          reactors: [
            { personaId: 'discord:user-1', displayName: 'Alice' },
            { personaId: 'discord:user-2', displayName: 'Bob' },
          ],
        },
      ];

      const result = collectReactorUsers(reactions, new Set());

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        discordId: 'user-1',
        username: 'Alice',
        displayName: 'Alice',
        isBot: false,
      });
      expect(result[1]).toEqual({
        discordId: 'user-2',
        username: 'Bob',
        displayName: 'Bob',
        isBot: false,
      });
    });

    it('should deduplicate users across multiple reactions', () => {
      const reactions: MessageReaction[] = [
        {
          emoji: '👍',
          isCustom: false,
          reactors: [{ personaId: 'discord:user-1', displayName: 'Alice' }],
        },
        {
          emoji: '❤️',
          isCustom: false,
          reactors: [
            { personaId: 'discord:user-1', displayName: 'Alice' }, // Duplicate
            { personaId: 'discord:user-2', displayName: 'Bob' },
          ],
        },
      ];

      const result = collectReactorUsers(reactions, new Set());

      expect(result).toHaveLength(2);
      expect(result.map(u => u.discordId)).toEqual(['user-1', 'user-2']);
    });

    it('should exclude users already in existing set', () => {
      const reactions: MessageReaction[] = [
        {
          emoji: '👍',
          isCustom: false,
          reactors: [
            { personaId: 'discord:existing-user', displayName: 'Already There' },
            { personaId: 'discord:new-user', displayName: 'New User' },
          ],
        },
      ];

      const existingUsers = new Set(['existing-user']);

      const result = collectReactorUsers(reactions, existingUsers);

      expect(result).toHaveLength(1);
      expect(result[0].discordId).toBe('new-user');
    });

    it('should return empty array when all users already exist', () => {
      const reactions: MessageReaction[] = [
        {
          emoji: '👍',
          isCustom: false,
          reactors: [{ personaId: 'discord:user-1', displayName: 'Alice' }],
        },
      ];

      const existingUsers = new Set(['user-1']);

      const result = collectReactorUsers(reactions, existingUsers);

      expect(result).toHaveLength(0);
    });

    it('should handle empty reactions array', () => {
      const result = collectReactorUsers([], new Set());

      expect(result).toHaveLength(0);
    });

    it('should handle reactions with no reactors', () => {
      const reactions: MessageReaction[] = [{ emoji: '👍', isCustom: false, reactors: [] }];

      const result = collectReactorUsers(reactions, new Set());

      expect(result).toHaveLength(0);
    });
  });
});
