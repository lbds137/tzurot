/**
 * Tests for GuildMemberResolver
 *
 * Unit tests for guild member resolution and info extraction.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { extractGuildMemberInfo, resolveEffectiveMember } from './GuildMemberResolver.js';
import type { Message, GuildMember, Role, Collection, Guild } from 'discord.js';
import { MESSAGE_LIMITS } from '@tzurot/common-types';

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
function createMockRoleCache(roles: Role[]): Collection<string, Role> {
  const cache = new Map<string, Role>();
  for (const role of roles) {
    cache.set(role.id, role);
  }
  return {
    values: () => cache.values(),
    [Symbol.iterator]: () => cache.values(),
  } as unknown as Collection<string, Role>;
}

/**
 * Create a mock guild member
 */
function createMockMember(overrides: {
  id?: string;
  roles?: Role[];
  displayHexColor?: string;
  joinedAt?: Date | null;
}): GuildMember {
  return {
    id: overrides.id ?? 'member-123',
    roles: { cache: createMockRoleCache(overrides.roles ?? []) },
    displayHexColor: overrides.displayHexColor ?? '#000000',
    joinedAt: overrides.joinedAt ?? null,
  } as unknown as GuildMember;
}

describe('GuildMemberResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('extractGuildMemberInfo', () => {
    it('should return undefined for null member', () => {
      const result = extractGuildMemberInfo(null, 'guild-123');

      expect(result).toBeUndefined();
    });

    it('should return undefined for undefined member', () => {
      const result = extractGuildMemberInfo(undefined, 'guild-123');

      expect(result).toBeUndefined();
    });

    it('should extract roles sorted by position (highest first)', () => {
      const roles = [
        createMockRole({ id: 'role-1', name: 'Low', position: 1 }),
        createMockRole({ id: 'role-3', name: 'High', position: 3 }),
        createMockRole({ id: 'role-2', name: 'Mid', position: 2 }),
      ];
      const member = createMockMember({ roles });

      const result = extractGuildMemberInfo(member, 'guild-123');

      expect(result?.roles).toEqual(['High', 'Mid', 'Low']);
    });

    it('should exclude @everyone role (same ID as guild)', () => {
      const guildId = 'guild-123';
      const roles = [
        createMockRole({ id: 'role-1', name: 'Member', position: 1 }),
        createMockRole({ id: guildId, name: '@everyone', position: 0 }),
      ];
      const member = createMockMember({ roles });

      const result = extractGuildMemberInfo(member, guildId);

      expect(result?.roles).toEqual(['Member']);
      expect(result?.roles).not.toContain('@everyone');
    });

    it('should limit roles to MAX_GUILD_ROLES', () => {
      const roles = Array.from({ length: 10 }, (_, i) =>
        createMockRole({ id: `role-${i}`, name: `Role${i}`, position: i })
      );
      const member = createMockMember({ roles });

      const result = extractGuildMemberInfo(member, 'guild-123');

      expect(result?.roles.length).toBeLessThanOrEqual(MESSAGE_LIMITS.MAX_GUILD_ROLES);
    });

    it('should include displayColor when not black', () => {
      const member = createMockMember({ displayHexColor: '#FF5500' });

      const result = extractGuildMemberInfo(member, 'guild-123');

      expect(result?.displayColor).toBe('#FF5500');
    });

    it('should not include displayColor when black (transparent)', () => {
      const member = createMockMember({ displayHexColor: '#000000' });

      const result = extractGuildMemberInfo(member, 'guild-123');

      expect(result?.displayColor).toBeUndefined();
    });

    it('should include joinedAt as ISO string', () => {
      const joinDate = new Date('2024-06-15T14:30:00Z');
      const member = createMockMember({ joinedAt: joinDate });

      const result = extractGuildMemberInfo(member, 'guild-123');

      expect(result?.joinedAt).toBe('2024-06-15T14:30:00.000Z');
    });

    it('should handle undefined joinedAt', () => {
      const member = createMockMember({ joinedAt: null });

      const result = extractGuildMemberInfo(member, 'guild-123');

      expect(result?.joinedAt).toBeUndefined();
    });

    it('should handle empty roles', () => {
      const member = createMockMember({ roles: [] });

      const result = extractGuildMemberInfo(member, 'guild-123');

      expect(result?.roles).toEqual([]);
    });
  });

  describe('resolveEffectiveMember', () => {
    const createMockMessage = (overrides: {
      member?: GuildMember | null;
      guild?: Guild | null;
      authorId?: string;
    }): Message => {
      const mockGuild =
        overrides.guild !== undefined
          ? overrides.guild
          : ({
              id: 'guild-123',
              members: {
                fetch: vi.fn().mockResolvedValue(createMockMember({ id: 'fetched-member' })),
              },
            } as unknown as Guild);

      return {
        member: overrides.member !== undefined ? overrides.member : null,
        guild: mockGuild,
        author: { id: overrides.authorId ?? 'author-123' },
      } as unknown as Message;
    };

    it('should return overrideMember when explicitly provided', async () => {
      const overrideMember = createMockMember({ id: 'override-member' });
      const message = createMockMessage({});

      const result = await resolveEffectiveMember(message, { overrideMember });

      expect(result).toBe(overrideMember);
    });

    it('should return null when overrideMember is explicitly null', async () => {
      const message = createMockMessage({
        member: createMockMember({ id: 'message-member' }),
      });

      const result = await resolveEffectiveMember(message, { overrideMember: null });

      expect(result).toBeNull();
    });

    it('should fetch member for overrideUser when no overrideMember', async () => {
      const fetchedMember = createMockMember({ id: 'fetched-for-override' });
      const mockGuild = {
        id: 'guild-123',
        members: { fetch: vi.fn().mockResolvedValue(fetchedMember) },
      } as unknown as Guild;
      const message = createMockMessage({ guild: mockGuild });

      const result = await resolveEffectiveMember(message, {
        overrideUser: { id: 'override-user-id' },
      });

      expect(result).toBe(fetchedMember);
      expect(mockGuild.members.fetch).toHaveBeenCalledWith('override-user-id');
    });

    it('should return null when overrideUser fetch fails', async () => {
      const mockGuild = {
        id: 'guild-123',
        members: { fetch: vi.fn().mockRejectedValue(new Error('Not found')) },
      } as unknown as Guild;
      const message = createMockMessage({ guild: mockGuild });

      const result = await resolveEffectiveMember(message, {
        overrideUser: { id: 'unknown-user' },
      });

      expect(result).toBeNull();
    });

    it('should return message.member when no overrides', async () => {
      const messageMember = createMockMember({ id: 'message-member' });
      const message = createMockMessage({ member: messageMember });

      const result = await resolveEffectiveMember(message, {});

      expect(result).toBe(messageMember);
    });

    it('should fetch message.author when message.member is null', async () => {
      const fetchedMember = createMockMember({ id: 'fetched-author' });
      const mockGuild = {
        id: 'guild-123',
        members: { fetch: vi.fn().mockResolvedValue(fetchedMember) },
      } as unknown as Guild;
      const message = createMockMessage({
        member: null,
        guild: mockGuild,
        authorId: 'author-id',
      });

      const result = await resolveEffectiveMember(message, {});

      expect(result).toBe(fetchedMember);
      expect(mockGuild.members.fetch).toHaveBeenCalledWith('author-id');
    });

    it('should return null when no guild available', async () => {
      const message = createMockMessage({
        member: null,
        guild: null,
      });

      const result = await resolveEffectiveMember(message, {});

      expect(result).toBeNull();
    });

    it('should return null when overrideUser provided but no guild', async () => {
      const message = createMockMessage({ guild: null });

      const result = await resolveEffectiveMember(message, {
        overrideUser: { id: 'some-user' },
      });

      expect(result).toBeNull();
    });
  });
});
