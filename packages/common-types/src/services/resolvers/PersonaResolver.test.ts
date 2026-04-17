/**
 * Tests for PersonaResolver
 *
 * Tests the cascading configuration pattern for persona resolution:
 * 1. Per-personality override (UserPersonalityConfig.personaId)
 * 2. User's explicit default (User.defaultPersonaId)
 * 3. Transient first-owned-persona fallback (warns, no persist)
 * 4. System default (errors, user has no personas at all)
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

// Shared logger mock — hoisted so `vi.mock` factory (hoisted too) can close over
// it and tests can still assert on which level fired.
const { mockLogger } = vi.hoisted(() => ({
  mockLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../utils/logger.js', () => ({
  createLogger: () => mockLogger,
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
        },
      });

      const result = await resolver.resolve('discord-123', 'personality-456');

      expect(result.source).toBe('context-override');
      expect(result.config.personaId).toBe('override-persona-123');
      expect(result.config.preferredName).toBe('Override Name');
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
        },
        ownedPersonas: [],
      });

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolve('discord-123', 'personality-456');

      expect(result.source).toBe('user-default');
      expect(result.config.personaId).toBe('default-persona-123');
      expect(result.config.preferredName).toBe('Default Name');
    });

    it('should return first owned persona as transient resolution without persisting', async () => {
      // Phase 3 regression guard: resolution is strictly read-only. When a user
      // has owned personas but no defaultPersonaId, we pick the first-owned
      // persona for this request only. Persistence is UserService's job (via
      // runMaintenanceTasks → backfillDefaultPersona on the next interaction).
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
          },
        ],
      });

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolve('discord-123', 'personality-456');

      expect(result.source).toBe('user-default');
      expect(result.sourceName).toBe('transient-first-owned');
      expect(result.config.personaId).toBe('first-owned-persona');

      // Must NOT persist. No Prisma writes from the read path.
      expect(mockPrismaClient.user.update).not.toHaveBeenCalled();

      // Must warn so the transient state is visible in production logs.
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          discordUserId: 'discord-123',
          userId: 'user-uuid',
          selectedPersonaId: 'first-owned-persona',
        }),
        expect.stringContaining('Transient resolution')
      );
    });

    it('should log error and fall through when defaultPersonaId is dangling', async () => {
      // Schema has onDelete: SetNull, so this shouldn't happen — but we guard
      // defensively as a precursor signal for Phase 5's NOT NULL FK upgrade.
      mockPrismaClient.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        defaultPersonaId: 'persona-that-was-deleted',
        defaultPersona: null, // relation returns null when referenced row is gone
        ownedPersonas: [
          {
            id: 'fallback-persona',
            preferredName: 'Fallback',
            pronouns: null,
            content: 'Fallback content',
          },
        ],
      });

      mockPrismaClient.userPersonalityConfig.findFirst.mockResolvedValue(null);

      const result = await resolver.resolve('discord-123', 'personality-456');

      // Falls through to owned-persona resolution so the request succeeds.
      expect(result.config.personaId).toBe('fallback-persona');
      expect(result.sourceName).toBe('transient-first-owned');

      // Dangling reference must be error-logged as a data-integrity signal.
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          discordUserId: 'discord-123',
          userId: 'user-uuid',
          defaultPersonaId: 'persona-that-was-deleted',
        }),
        expect.stringContaining('Dangling defaultPersonaId')
      );
    });

    it('should return system default and log error when user has no personas at all', async () => {
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

      // Post-Phase-2, every user should have at least one persona. Log at error
      // level so provisioning bugs surface loudly in logs.
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          discordUserId: 'discord-123',
          userId: 'user-uuid',
        }),
        expect.stringContaining('User has no personas')
      );
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
      mockPrismaClient.user.findUnique.mockResolvedValueOnce({
        id: 'user-uuid',
        defaultPersonaId: 'persona-123',
        defaultPersona: {
          id: 'persona-123',
          preferredName: 'Name',
          pronouns: 'they/them',
          content: 'Content',
        },
        ownedPersonas: [],
      });

      mockPrismaClient.userPersonalityConfig.findFirst
        .mockResolvedValueOnce(null) // persona override check
        .mockResolvedValueOnce({ configOverrides: null }); // focus mode check (no overrides)

      const result = await resolver.resolveForMemory('discord-123', 'personality-456');

      expect(result).toEqual({
        personaId: 'persona-123',
        focusModeEnabled: false,
      });
    });

    it('should return focusModeEnabled true when focus mode is enabled', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValueOnce({
        id: 'user-uuid',
        defaultPersonaId: 'persona-123',
        defaultPersona: {
          id: 'persona-123',
          preferredName: 'Name',
          pronouns: 'they/them',
          content: 'Content',
        },
        ownedPersonas: [],
      });

      mockPrismaClient.userPersonalityConfig.findFirst
        .mockResolvedValueOnce(null) // persona override
        .mockResolvedValueOnce({ configOverrides: { focusModeEnabled: true } }); // focus mode enabled

      const result = await resolver.resolveForMemory('discord-123', 'personality-456');

      expect(result).toEqual({
        personaId: 'persona-123',
        focusModeEnabled: true,
      });
    });

    it('should default focusModeEnabled to false when no config exists', async () => {
      mockPrismaClient.user.findUnique.mockResolvedValueOnce({
        id: 'user-uuid',
        defaultPersonaId: 'persona-123',
        defaultPersona: {
          id: 'persona-123',
          preferredName: 'Name',
          pronouns: null,
          content: 'Content',
        },
        ownedPersonas: [],
      });

      mockPrismaClient.userPersonalityConfig.findFirst
        .mockResolvedValueOnce(null) // persona override
        .mockResolvedValueOnce(null); // no config for focus mode (covers both "user missing" and "user exists but no config" — single JOIN query)

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
      mockPrismaClient.user.findUnique.mockResolvedValueOnce({
        id: 'user-uuid',
        defaultPersonaId: 'persona-123',
        defaultPersona: {
          id: 'persona-123',
          preferredName: 'Name',
          pronouns: null,
          content: 'Content',
        },
        ownedPersonas: [],
      });

      mockPrismaClient.userPersonalityConfig.findFirst
        .mockResolvedValueOnce(null) // persona override
        .mockRejectedValueOnce(new Error('DB error')); // focus mode check fails

      const result = await resolver.resolveForMemory('discord-123', 'personality-456');

      // Should still return valid result with focusModeEnabled defaulting to false
      expect(result).toEqual({
        personaId: 'persona-123',
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

    it('should return null for discord: format with a warn log (post-Phase-4 tripwire)', async () => {
      // Post-Phase-4, resolveToUuid is UUID-only. The `discord:XXXX`
      // format should have been stripped at the bot-client boundary by
      // ExtendedContextPersonaResolver. A non-UUID reaching here signals
      // a regression, so we warn-log for visibility and return null.
      // This test documents the contract — no DB calls should happen.
      const result = await resolver.resolveToUuid('discord:123456789', 'personality-123');

      expect(result).toBeNull();
      expect(mockPrismaClient.user.findUnique).not.toHaveBeenCalled();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ personaId: 'discord:123456789' }),
        expect.stringContaining('Non-UUID personaId')
      );
    });

    it('should return null for empty string WITHOUT warning (expected sentinel)', async () => {
      // Empty string is the documented "unresolved extended-context user"
      // sentinel produced by the strip pass. It's the quiet no-op case —
      // not a tripwire, not a warn.
      const result = await resolver.resolveToUuid('', 'personality-123');

      expect(result).toBeNull();
      expect(mockPrismaClient.user.findUnique).not.toHaveBeenCalled();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should return null for unknown format with a warn log', async () => {
      const result = await resolver.resolveToUuid('invalid-format', 'personality-123');

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalled();
    });
  });

  // Note: the "auto-default persistence error handling" describe block was
  // removed in the Phase 3 refactor. Persistence is no longer part of the
  // resolve() path, so there's no write-failure mode to test here. Provisioning
  // tests live in UserService.test.ts (createUserWithDefaultPersona +
  // backfillDefaultPersona).

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
