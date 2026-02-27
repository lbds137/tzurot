/**
 * Tests for UserContextResolver
 *
 * Unit tests for user identity resolution and context epoch lookup.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lookupContextEpoch, resolveUserContext } from './UserContextResolver.js';
import type {
  UserService,
  PersonaResolver,
  PrismaClient,
  LoadedPersonality,
} from '@tzurot/common-types';

describe('UserContextResolver', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('lookupContextEpoch', () => {
    it('should return context epoch when found', async () => {
      const epochDate = new Date('2024-01-15T10:00:00Z');
      const mockPrisma = {
        userPersonaHistoryConfig: {
          findUnique: vi.fn().mockResolvedValue({ lastContextReset: epochDate }),
        },
      } as unknown as PrismaClient;

      const result = await lookupContextEpoch(
        mockPrisma,
        'user-123',
        'personality-456',
        'persona-789'
      );

      expect(result).toBe(epochDate);
      expect(mockPrisma.userPersonaHistoryConfig.findUnique).toHaveBeenCalledWith({
        where: {
          userId_personalityId_personaId: {
            userId: 'user-123',
            personalityId: 'personality-456',
            personaId: 'persona-789',
          },
        },
        select: { lastContextReset: true },
      });
    });

    it('should return undefined when no config found', async () => {
      const mockPrisma = {
        userPersonaHistoryConfig: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaClient;

      const result = await lookupContextEpoch(
        mockPrisma,
        'user-123',
        'personality-456',
        'persona-789'
      );

      expect(result).toBeUndefined();
    });

    it('should return undefined when lastContextReset is null', async () => {
      const mockPrisma = {
        userPersonaHistoryConfig: {
          findUnique: vi.fn().mockResolvedValue({ lastContextReset: null }),
        },
      } as unknown as PrismaClient;

      const result = await lookupContextEpoch(
        mockPrisma,
        'user-123',
        'personality-456',
        'persona-789'
      );

      expect(result).toBeUndefined();
    });
  });

  describe('resolveUserContext', () => {
    const createMockPersonality = (): LoadedPersonality => ({
      id: 'personality-123',
      name: 'TestBot',
      displayName: 'Test Bot',
      slug: 'testbot',
      systemPrompt: 'Test prompt',
      model: 'test-model',
      temperature: 0.7,
      maxTokens: 2000,
      contextWindowTokens: 131072,
      characterInfo: '',
      personalityTraits: '',
    });

    const createMockDeps = () => ({
      userService: {
        getOrCreateUser: vi.fn().mockResolvedValue('internal-user-uuid'),
        getUserTimezone: vi.fn().mockResolvedValue('America/New_York'),
      } as unknown as UserService,
      personaResolver: {
        resolve: vi.fn().mockResolvedValue({
          config: {
            personaId: 'persona-uuid-123',
            personaName: 'AlicePersona',
            preferredName: 'Alice',
            pronouns: null,
            content: '',
          },
          source: 'system-default',
        }),
      } as unknown as PersonaResolver,
      prisma: {
        userPersonaHistoryConfig: {
          findUnique: vi.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaClient,
    });

    it('should resolve user context with all fields', async () => {
      const deps = createMockDeps();
      const personality = createMockPersonality();
      const user = { id: 'discord-user-123', username: 'alice#1234', bot: false };

      const result = await resolveUserContext(user, personality, 'Alice Display', deps);

      expect(result).toEqual({
        internalUserId: 'internal-user-uuid',
        discordUserId: 'discord-user-123',
        personaId: 'persona-uuid-123',
        personaName: 'Alice',
        userTimezone: 'America/New_York',
        contextEpoch: undefined,
        history: [],
      });
    });

    it('should call userService.getOrCreateUser with correct args', async () => {
      const deps = createMockDeps();
      const personality = createMockPersonality();
      const user = { id: 'discord-123', username: 'bob', bot: false };

      await resolveUserContext(user, personality, 'Bob Display', deps);

      expect(deps.userService.getOrCreateUser).toHaveBeenCalledWith(
        'discord-123',
        'bob',
        'Bob Display',
        undefined,
        false
      );
    });

    it('should handle bot user flag', async () => {
      const deps = createMockDeps();
      const personality = createMockPersonality();
      const user = { id: 'bot-123', username: 'botname', bot: true };

      await resolveUserContext(user, personality, 'Bot Display', deps);

      expect(deps.userService.getOrCreateUser).toHaveBeenCalledWith(
        'bot-123',
        'botname',
        'Bot Display',
        undefined,
        true
      );
    });

    it('should throw when userService returns null (bot rejection)', async () => {
      const deps = createMockDeps();
      vi.mocked(deps.userService.getOrCreateUser).mockResolvedValue(null);
      const personality = createMockPersonality();
      const user = { id: 'bot-123', username: 'bot', bot: true };

      await expect(resolveUserContext(user, personality, 'Bot', deps)).rejects.toThrow(
        'Cannot process messages from bots'
      );
    });

    it('should include context epoch when set', async () => {
      const deps = createMockDeps();
      const epochDate = new Date('2024-06-01T00:00:00Z');
      // Cast through unknown since we only need lastContextReset for the test
      (
        deps.prisma.userPersonaHistoryConfig.findUnique as ReturnType<typeof vi.fn>
      ).mockResolvedValue({ lastContextReset: epochDate });
      const personality = createMockPersonality();
      const user = { id: 'discord-123', username: 'alice' };

      const result = await resolveUserContext(user, personality, 'Alice', deps);

      expect(result.contextEpoch).toBe(epochDate);
    });

    it('should handle null preferred name', async () => {
      const deps = createMockDeps();
      vi.mocked(deps.personaResolver.resolve).mockResolvedValue({
        config: {
          personaId: 'persona-uuid',
          personaName: 'TestPersona',
          preferredName: null,
          pronouns: null,
          content: '',
        },
        source: 'system-default',
      });
      const personality = createMockPersonality();
      const user = { id: 'discord-123', username: 'alice' };

      const result = await resolveUserContext(user, personality, 'Alice', deps);

      // personaName in result comes from preferredName (user's chosen name)
      expect(result.personaName).toBeNull();
    });

    it('should handle undefined timezone', async () => {
      const deps = createMockDeps();
      vi.mocked(deps.userService.getUserTimezone).mockResolvedValue(undefined as unknown as string);
      const personality = createMockPersonality();
      const user = { id: 'discord-123', username: 'alice' };

      const result = await resolveUserContext(user, personality, 'Alice', deps);

      expect(result.userTimezone).toBeUndefined();
    });

    it('should return empty history array (deferred to caller)', async () => {
      const deps = createMockDeps();
      const personality = createMockPersonality();
      const user = { id: 'discord-123', username: 'alice' };

      const result = await resolveUserContext(user, personality, 'Alice', deps);

      expect(result.history).toEqual([]);
    });
  });
});
