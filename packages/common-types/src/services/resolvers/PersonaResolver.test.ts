/**
 * Tests for PersonaResolver
 *
 * Tests the cascading configuration pattern for persona resolution:
 * 1. Per-personality override (UserPersonalityConfig.personaId)
 * 2. User's default persona (User.defaultPersonaId)
 * 3. Auto-default to first owned persona (lazy initialization)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PersonaResolver } from './PersonaResolver.js';

// Mock Prisma client
const mockPrismaClient = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  userPersonalityConfig: {
    findFirst: vi.fn(),
  },
  persona: {
    findUnique: vi.fn(),
  },
};

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('PersonaResolver', () => {
  let resolver: PersonaResolver;

  beforeEach(() => {
    vi.clearAllMocks();
    // Disable cleanup interval in tests
    resolver = new PersonaResolver(mockPrismaClient as any, { enableCleanup: false });
  });

  afterEach(() => {
    resolver.stopCleanup();
  });

  describe('resolve (full configuration)', () => {
    it('should return system default for anonymous users', async () => {
      const result = await resolver.resolve(undefined, 'personality-123');

      expect(result.source).toBe('system-default');
      expect(result.config.personaId).toBe('');
      expect(mockPrismaClient.user.findUnique).not.toHaveBeenCalled();
    });

    it('should return system default for empty userId', async () => {
      const result = await resolver.resolve('', 'personality-123');

      expect(result.source).toBe('system-default');
      expect(result.config.personaId).toBe('');
    });

    it('should return system default when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const result = await resolver.resolve('discord-123', 'personality-123');

      expect(result.source).toBe('system-default');
      expect(result.config.personaId).toBe('');
    });

    it('should return personality-specific override if exists', async () => {
      // User has no default but has personality override
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: null,
        defaultPersona: null,
        ownedPersonas: [],
      });

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue({
        persona: {
          id: 'override-persona-123',
          preferredName: 'Override Name',
          pronouns: 'they/them',
          content: 'Override content',
          shareLtmAcrossPersonalities: true,
        },
      });

      const result = await resolver.resolve('discord-123', 'personality-456');

      expect(result.source).toBe('context-override');
      expect(result.config.personaId).toBe('override-persona-123');
      expect(result.config.preferredName).toBe('Override Name');
      expect(result.config.shareLtmAcrossPersonalities).toBe(true);
    });

    it('should return user default when no personality override exists', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: 'default-persona-123',
        defaultPersona: {
          id: 'default-persona-123',
          preferredName: 'Default Name',
          pronouns: 'she/her',
          content: 'Default content',
          shareLtmAcrossPersonalities: false,
        },
        ownedPersonas: [],
      });

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolve('discord-123', 'personality-456');

      expect(result.source).toBe('user-default');
      expect(result.config.personaId).toBe('default-persona-123');
      expect(result.config.preferredName).toBe('Default Name');
    });

    it('should auto-default to first owned persona and persist it', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: null,
        defaultPersona: null,
        ownedPersonas: [
          {
            id: 'first-owned-persona',
            preferredName: 'First Owned',
            pronouns: 'he/him',
            content: 'First owned content',
            shareLtmAcrossPersonalities: false,
          },
        ],
      });

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrismaClient.user.update.mockResolvedValue({});

      const result = await resolver.resolve('discord-123', 'personality-456');

      expect(result.source).toBe('user-default');
      expect(result.sourceName).toBe('auto-default');
      expect(result.config.personaId).toBe('first-owned-persona');

      // Should persist the auto-default
      expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
        where: { id: 'user-uuid' },
        data: { defaultPersonaId: 'first-owned-persona' },
      });
    });

    it('should return system default when user has no personas at all', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: null,
        defaultPersona: null,
        ownedPersonas: [],
      });

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolve('discord-123', 'personality-456');

      expect(result.source).toBe('system-default');
      expect(result.config.personaId).toBe('');
    });

    it('should resolve without personalityId (default persona only)', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: 'default-persona-123',
        defaultPersona: {
          id: 'default-persona-123',
          preferredName: 'Default Name',
          pronouns: null,
          content: 'Content',
          shareLtmAcrossPersonalities: false,
        },
        ownedPersonas: [],
      });

      // No personalityId means no personality config lookup
      const result = await resolver.resolve('discord-123');

      expect(result.source).toBe('user-default');
      expect(result.config.personaId).toBe('default-persona-123');
      // Should not check for personality overrides
      expect(mockPrismaClient.userPersonalityConfig.findFirst).not.toHaveBeenCalled();
    });

    it('should use cache on subsequent calls', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: 'persona-123',
        defaultPersona: {
          id: 'persona-123',
          preferredName: 'Cached',
          pronouns: null,
          content: '',
          shareLtmAcrossPersonalities: false,
        },
        ownedPersonas: [],
      });

      // First call
      await resolver.resolve('discord-123', 'personality-456');
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledTimes(1);

      // Second call should use cache
      await resolver.resolve('discord-123', 'personality-456');
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should invalidate cache for user', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: 'persona-123',
        defaultPersona: {
          id: 'persona-123',
          preferredName: 'Original',
          pronouns: null,
          content: '',
          shareLtmAcrossPersonalities: false,
        },
        ownedPersonas: [],
      });

      // First call
      await resolver.resolve('discord-123', 'personality-456');
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledTimes(1);

      // Invalidate cache
      resolver.invalidateUserCache('discord-123');

      // Should query again
      await resolver.resolve('discord-123', 'personality-456');
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.user.findUnique.mockRejectedValue(new Error('DB connection failed'));

      const result = await resolver.resolve('discord-123', 'personality-456');

      expect(result.source).toBe('system-default');
      expect(result.config.personaId).toBe('');
    });
  });

  describe('resolveForMemory', () => {
    it('should return lightweight memory info when persona exists', async () => {
      mockPrismaClient.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-uuid',
          defaultPersonaId: 'persona-123',
          defaultPersona: {
            id: 'persona-123',
            preferredName: 'Name',
            pronouns: 'they/them',
            content: 'Content',
            shareLtmAcrossPersonalities: true,
          },
          ownedPersonas: [],
        })
        // Second call for focus mode check
        .mockResolvedValueOnce({ id: 'user-uuid' });

      mockPrismaClient.userPersonalityConfig.findFirst
        .mockResolvedValueOnce(null) // persona override check
        .mockResolvedValueOnce({ focusModeEnabled: false }); // focus mode check

      const result = await resolver.resolveForMemory('discord-123', 'personality-456');

      expect(result).toEqual({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: true,
        focusModeEnabled: false,
      });
    });

    it('should return focusModeEnabled true when focus mode is enabled', async () => {
      mockPrismaClient.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-uuid',
          defaultPersonaId: 'persona-123',
          defaultPersona: {
            id: 'persona-123',
            preferredName: 'Name',
            pronouns: 'they/them',
            content: 'Content',
            shareLtmAcrossPersonalities: false,
          },
          ownedPersonas: [],
        })
        .mockResolvedValueOnce({ id: 'user-uuid' });

      mockPrismaClient.userPersonalityConfig.findFirst
        .mockResolvedValueOnce(null) // persona override
        .mockResolvedValueOnce({ focusModeEnabled: true }); // focus mode enabled

      const result = await resolver.resolveForMemory('discord-123', 'personality-456');

      expect(result).toEqual({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
        focusModeEnabled: true,
      });
    });

    it('should default focusModeEnabled to false when no config exists', async () => {
      mockPrismaClient.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-uuid',
          defaultPersonaId: 'persona-123',
          defaultPersona: {
            id: 'persona-123',
            preferredName: 'Name',
            pronouns: null,
            content: 'Content',
            shareLtmAcrossPersonalities: false,
          },
          ownedPersonas: [],
        })
        .mockResolvedValueOnce({ id: 'user-uuid' });

      mockPrismaClient.userPersonalityConfig.findFirst
        .mockResolvedValueOnce(null) // persona override
        .mockResolvedValueOnce(null); // no config for focus mode

      const result = await resolver.resolveForMemory('discord-123', 'personality-456');

      expect(result?.focusModeEnabled).toBe(false);
    });

    it('should default focusModeEnabled to false when user not found in focus mode check', async () => {
      mockPrismaClient.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-uuid',
          defaultPersonaId: 'persona-123',
          defaultPersona: {
            id: 'persona-123',
            preferredName: 'Name',
            pronouns: null,
            content: 'Content',
            shareLtmAcrossPersonalities: false,
          },
          ownedPersonas: [],
        })
        .mockResolvedValueOnce(null); // user not found in focus mode check

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValueOnce(null);

      const result = await resolver.resolveForMemory('discord-123', 'personality-456');

      expect(result?.focusModeEnabled).toBe(false);
    });

    it('should return null for system-default resolution', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const result = await resolver.resolveForMemory('discord-123', 'personality-456');

      expect(result).toBeNull();
    });

    it('should return null when resolved persona has empty personaId', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: null,
        defaultPersona: null,
        ownedPersonas: [],
      });

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveForMemory('discord-123', 'personality-456');

      expect(result).toBeNull();
    });

    it('should handle focus mode check errors gracefully', async () => {
      mockPrismaClient.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-uuid',
          defaultPersonaId: 'persona-123',
          defaultPersona: {
            id: 'persona-123',
            preferredName: 'Name',
            pronouns: null,
            content: 'Content',
            shareLtmAcrossPersonalities: false,
          },
          ownedPersonas: [],
        })
        .mockRejectedValueOnce(new Error('DB error')); // focus mode check fails

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValueOnce(null);

      const result = await resolver.resolveForMemory('discord-123', 'personality-456');

      // Should still return valid result with focusModeEnabled defaulting to false
      expect(result).toEqual({
        personaId: 'persona-123',
        shareLtmAcrossPersonalities: false,
        focusModeEnabled: false,
      });
    });
  });

  describe('getPersonaContentForPrompt', () => {
    // Valid UUID format required for database lookup
    const validPersonaUuid = '12345678-1234-1234-1234-123456789abc';

    it('should return formatted content with all fields', async () => {
      mockPrismaClient.persona.findUnique.mockResolvedValue({
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'A friendly person who loves coding',
      });

      const result = await resolver.getPersonaContentForPrompt(validPersonaUuid);

      expect(result).toBe('Name: Alice\nPronouns: she/her\nA friendly person who loves coding');
    });

    it('should return content without optional fields', async () => {
      mockPrismaClient.persona.findUnique.mockResolvedValue({
        preferredName: null,
        pronouns: null,
        content: 'Just content',
      });

      const result = await resolver.getPersonaContentForPrompt(validPersonaUuid);

      expect(result).toBe('Just content');
    });

    it('should return content with only name', async () => {
      mockPrismaClient.persona.findUnique.mockResolvedValue({
        preferredName: 'Bob',
        pronouns: null,
        content: '',
      });

      const result = await resolver.getPersonaContentForPrompt(validPersonaUuid);

      expect(result).toBe('Name: Bob');
    });

    it('should return null if persona not found', async () => {
      mockPrismaClient.persona.findUnique.mockResolvedValue(null);

      const result = await resolver.getPersonaContentForPrompt(validPersonaUuid);

      expect(result).toBeNull();
    });

    it('should return null if all fields are empty', async () => {
      mockPrismaClient.persona.findUnique.mockResolvedValue({
        preferredName: null,
        pronouns: '',
        content: null,
      });

      const result = await resolver.getPersonaContentForPrompt(validPersonaUuid);

      expect(result).toBeNull();
    });

    it('should handle database errors gracefully', async () => {
      mockPrismaClient.persona.findUnique.mockRejectedValue(new Error('DB error'));

      const result = await resolver.getPersonaContentForPrompt(validPersonaUuid);

      expect(result).toBeNull();
    });

    it('should return null for non-UUID personaIds (discord: format)', async () => {
      // discord: format IDs should not hit the database
      const result = await resolver.getPersonaContentForPrompt('discord:123456789');

      expect(result).toBeNull();
      expect(mockPrismaClient.persona.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('resolveToUuid', () => {
    it('should return UUID as-is when personaId is already a valid UUID', async () => {
      const uuid = '12345678-1234-1234-1234-123456789abc';

      const result = await resolver.resolveToUuid(uuid, 'personality-123');

      expect(result).toBe(uuid);
      // Should not call resolve() for already-valid UUIDs
      expect(mockPrismaClient.user.findUnique).not.toHaveBeenCalled();
    });

    it('should resolve discord: format to actual persona UUID', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: 'resolved-persona-uuid',
        defaultPersona: {
          id: 'resolved-persona-uuid',
          preferredName: 'Test User',
          pronouns: null,
          content: 'User content',
          shareLtmAcrossPersonalities: false,
        },
        ownedPersonas: [],
      });

      const result = await resolver.resolveToUuid('discord:123456789', 'personality-123');

      expect(result).toBe('resolved-persona-uuid');
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { discordId: '123456789' },
        })
      );
    });

    it('should return null for discord: format when user not found', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue(null);

      const result = await resolver.resolveToUuid('discord:999999999', 'personality-123');

      expect(result).toBeNull();
    });

    it('should return null for discord: format when user has no persona', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: null,
        defaultPersona: null,
        ownedPersonas: [],
      });

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolveToUuid('discord:123456789', 'personality-123');

      expect(result).toBeNull();
    });

    it('should return null for unknown format', async () => {
      const result = await resolver.resolveToUuid('invalid-format', 'personality-123');

      expect(result).toBeNull();
    });

    it('should use per-personality override when available for discord: format', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: 'default-persona-uuid',
        defaultPersona: {
          id: 'default-persona-uuid',
          preferredName: 'Default',
          pronouns: null,
          content: '',
          shareLtmAcrossPersonalities: false,
        },
        ownedPersonas: [],
      });

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue({
        persona: {
          id: 'override-persona-uuid',
          preferredName: 'Override',
          pronouns: null,
          content: '',
          shareLtmAcrossPersonalities: false,
        },
      });

      const result = await resolver.resolveToUuid('discord:123456789', 'specific-personality');

      expect(result).toBe('override-persona-uuid');
    });
  });

  describe('auto-default persistence error handling', () => {
    it('should still return persona even if persist fails', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: null,
        defaultPersona: null,
        ownedPersonas: [
          {
            id: 'first-owned-persona',
            preferredName: 'First',
            pronouns: null,
            content: '',
            shareLtmAcrossPersonalities: false,
          },
        ],
      });

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);
      mockPrismaClient.user.update.mockRejectedValue(new Error('Update failed'));

      const result = await resolver.resolve('discord-123', 'personality-456');

      // Should still return the persona even if persist failed
      expect(result.config.personaId).toBe('first-owned-persona');
      expect(result.source).toBe('user-default');
    });
  });

  describe('cache management', () => {
    it('should clear all cache entries', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: 'persona-123',
        defaultPersona: {
          id: 'persona-123',
          preferredName: 'Test',
          pronouns: null,
          content: '',
          shareLtmAcrossPersonalities: false,
        },
        ownedPersonas: [],
      });

      // Populate cache
      await resolver.resolve('user-1', 'personality-1');
      await resolver.resolve('user-2', 'personality-2');
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledTimes(2);

      // Clear cache
      resolver.clearCache();

      // Both should query again
      await resolver.resolve('user-1', 'personality-1');
      await resolver.resolve('user-2', 'personality-2');
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledTimes(4);
    });
  });

  describe('cleanup interval', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should start cleanup interval when enabled', () => {
      const resolverWithCleanup = new PersonaResolver(mockPrismaClient as any, {
        enableCleanup: true,
      });

      // Should have started the interval
      expect(resolverWithCleanup).toBeDefined();

      // Cleanup
      resolverWithCleanup.stopCleanup();
    });

    it('should clean up expired entries when interval fires', async () => {
      const resolverWithCleanup = new PersonaResolver(mockPrismaClient as any, {
        enableCleanup: true,
        cacheTtlMs: 1000, // 1 second TTL for testing
      });

      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: 'persona-123',
        defaultPersona: {
          id: 'persona-123',
          preferredName: 'Test',
          pronouns: null,
          content: '',
          shareLtmAcrossPersonalities: false,
        },
        ownedPersonas: [],
      });

      // Populate cache
      await resolverWithCleanup.resolve('user-1', 'personality-1');
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledTimes(1);

      // Should use cache
      await resolverWithCleanup.resolve('user-1', 'personality-1');
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledTimes(1);

      // Advance time past TTL
      vi.advanceTimersByTime(2000);

      // Advance time past cleanup interval (60s)
      vi.advanceTimersByTime(60000);

      // Now cache entry should be expired - next call should query again
      await resolverWithCleanup.resolve('user-1', 'personality-1');
      expect(mockPrismaClient.user.findUnique).toHaveBeenCalledTimes(2);

      // Cleanup
      resolverWithCleanup.stopCleanup();
    });

    it('should handle stopCleanup when no interval is running', () => {
      // Resolver created with cleanup disabled
      expect(() => resolver.stopCleanup()).not.toThrow();
    });

    it('should be safe to call stopCleanup multiple times', () => {
      const resolverWithCleanup = new PersonaResolver(mockPrismaClient as any, {
        enableCleanup: true,
      });

      // Stop multiple times - should not throw
      expect(() => {
        resolverWithCleanup.stopCleanup();
        resolverWithCleanup.stopCleanup();
      }).not.toThrow();
    });
  });
});
