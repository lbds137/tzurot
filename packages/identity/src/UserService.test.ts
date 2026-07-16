import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  UserService,
  buildShellPlaceholderPersonaName,
  getOrCreateUserService,
} from './UserService.js';
import { resetConfig } from '@tzurot/common-types/config/config';
import type { PrismaClient } from '@tzurot/common-types/services/prisma';

// Use vi.hoisted() to create mocks that persist across test resets
const { mockGenerateUserUuid, mockGeneratePersonaUuid } = vi.hoisted(() => ({
  mockGenerateUserUuid: vi.fn(),
  mockGeneratePersonaUuid: vi.fn(),
}));

// Mock dependencies — UserService now imports Prisma + the deterministic-UUID
// helpers from the @tzurot/common-types barrel, so override them there.
vi.mock('@tzurot/common-types/services/prisma', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types/services/prisma')>();
  return {
    ...actual,
    Prisma: {
      TransactionClient: class {},
    },
  };
});
vi.mock('@tzurot/common-types/utils/deterministicUuid', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@tzurot/common-types/utils/deterministicUuid')>();
  return {
    ...actual,
    DNS_NAMESPACE: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
    generateUserUuid: mockGenerateUserUuid,
    generatePersonaUuid: mockGeneratePersonaUuid,
  };
});
describe('UserService', () => {
  let userService: UserService;
  let mockPrisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    persona: {
      findUnique: ReturnType<typeof vi.fn>;
      updateMany: ReturnType<typeof vi.fn>;
    };
    userPersonalityConfig: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    $executeRaw: ReturnType<typeof vi.fn>;
  };

  /**
   * Helper: decode the values passed to a tagged-template $executeRaw call
   * into an object matching the CTE column order. getOrCreateUser uses one
   * CTE per path:
   *
   *   persona: (id, name, preferred_name, description, content, owner_id)
   *   user:    (id, discord_id, username, is_superuser, default_persona_id)
   *
   * The values array the mock captures skips NOW() (which is SQL-literal in
   * the template, not an interpolated value), so indices here are contiguous.
   *
   * CAVEAT: the `call.length < 12` guard below catches column count changes
   * but NOT reorders. If the CTE VALUES-clause order shifts (or a new
   * interpolated value is added earlier), this decoder returns wrong values
   * silently. The `isSuperuser=false` test asserts discordId + username as
   * sentinels so a reorder shows up there, but other-slot reorders won't
   * fail loud until each field is asserted. Update this decoder together
   * with any CTE template change in UserService.ts.
   */
  function decodeCreateUserCall(call: unknown[] | undefined): {
    personaId: string;
    personaName: string;
    personaPreferredName: string;
    personaDescription: string;
    personaContent: string;
    ownerId: string;
    userId: string;
    discordId: string;
    username: string;
    isSuperuser: boolean;
  } | null {
    if (!call || call.length < 12) return null;
    const values = call.slice(1);
    return {
      personaId: values[0] as string,
      personaName: values[1] as string,
      personaPreferredName: values[2] as string,
      personaDescription: values[3] as string,
      personaContent: values[4] as string,
      ownerId: values[5] as string,
      userId: values[6] as string,
      discordId: values[7] as string,
      username: values[8] as string,
      isSuperuser: values[9] as boolean,
    };
  }

  beforeEach(() => {
    // Set up deterministic UUID mock return values for each test
    mockGenerateUserUuid.mockReturnValue('test-user-uuid');
    mockGeneratePersonaUuid.mockReturnValue('test-persona-uuid');

    mockPrisma = {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
      },
      persona: {
        findUnique: vi.fn(),
        updateMany: vi.fn(),
      },
      userPersonalityConfig: {
        findUnique: vi.fn(),
      },
      // User + default persona are created atomically via a single
      // CTE. Default mock returns 1 (rows affected) so the happy path doesn't
      // need to configure it per-test.
      $executeRaw: vi.fn().mockResolvedValue(1),
    };

    userService = new UserService(mockPrisma as any);
  });

  afterEach(() => {
    vi.clearAllMocks(); // Use clearAllMocks to preserve mock implementations
    resetConfig();
  });

  describe('decodeCreateUserCall helper', () => {
    // Explicit contract for the test-only decoder so the null-return path is
    // exercised directly rather than only implicit via downstream optional
    // chaining.
    it('returns null for undefined (no call captured)', () => {
      expect(decodeCreateUserCall(undefined)).toBeNull();
    });

    it('returns null when the captured call has fewer than 12 entries', () => {
      // Captured calls have shape [TemplateStringsArray, ...values]. The CTE
      // interpolates 11 values so a valid capture is length 12; a shorter
      // array indicates the CTE template changed shape and the decoder
      // should fail loud instead of reading junk from the wrong slot.
      expect(decodeCreateUserCall([])).toBeNull();
      expect(decodeCreateUserCall(['template'])).toBeNull();
      // Eleven-entry boundary (template + 10 values — one short of the
      // 11-value CTE). The guard rejects exactly at this edge.
      expect(decodeCreateUserCall(new Array(11).fill('x'))).toBeNull();
    });
  });

  describe('getOrCreateUser', () => {
    it('should return cached user ID if available', async () => {
      // First call to populate cache. defaultPersonaId is always
      // non-null at the type level, so runMaintenanceTasks has no backfill
      // branch — the mock just needs a valid defaultPersonaId to match reality.
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'cached-user-id',
        isSuperuser: false,
        username: 'testuser',
        defaultPersonaId: 'cached-persona-id',
      });

      const result1 = await userService.getOrCreateUser('123456', 'testuser');
      expect(result1?.userId).toBe('cached-user-id');
      expect(result1?.defaultPersonaId).toBe('cached-persona-id');

      // Second call should use cache
      const result2 = await userService.getOrCreateUser('123456', 'testuser');
      expect(result2?.userId).toBe('cached-user-id');

      // findUnique should only be called once
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('invalidateUser evicts the cache so the next call re-reads the DB', async () => {
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'user-before',
          isSuperuser: false,
          username: 'testuser',
          defaultPersonaId: 'persona-before',
        })
        .mockResolvedValueOnce({
          id: 'user-after',
          isSuperuser: false,
          username: 'testuser',
          defaultPersonaId: 'persona-after',
        });

      const first = await userService.getOrCreateUser('123456', 'testuser');
      expect(first?.userId).toBe('user-before');

      // Simulates account deletion: the row is gone, cache must not serve it.
      userService.invalidateUser('123456');

      const second = await userService.getOrCreateUser('123456', 'testuser');
      expect(second?.userId).toBe('user-after');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should return existing user ID if found in database', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-id',
        isSuperuser: false,
        username: 'existinguser',
        defaultPersonaId: 'existing-persona-id',
      });

      const result = await userService.getOrCreateUser('123456', 'testuser');

      expect(result?.userId).toBe('existing-user-id');
      expect(result?.defaultPersonaId).toBe('existing-persona-id');
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('should update placeholder username AND rename placeholder persona when real username is provided', async () => {
      // User was created by api-gateway via getOrCreateUserShell with discordId
      // as placeholder username AND persona name ("User {discordId}"). On first
      // bot-client interaction with a real username, both get upgraded
      // sequentially in the same `runMaintenanceTasks` pass. The two writes
      // (user.update + persona.updateMany) are NOT wrapped in a transaction;
      // a mid-pass crash would leave the user upgraded but the persona stuck
      // on the placeholder name.
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-id',
        isSuperuser: false,
        username: '123456', // Placeholder = discordId
        defaultPersonaId: 'existing-persona-id',
      });
      mockPrisma.user.update.mockResolvedValueOnce({
        id: 'existing-user-id',
        username: 'realusername',
      });
      mockPrisma.persona.updateMany.mockResolvedValueOnce({ count: 1 });

      const result = await userService.getOrCreateUser('123456', 'realusername');

      expect(result?.userId).toBe('existing-user-id');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'existing-user-id' },
        data: { username: 'realusername' },
      });
      // Placeholder persona renamed via idempotent updateMany (WHERE clause
      // matches only rows with the exact placeholder name, so concurrent
      // maintenance calls don't race — second one matches zero rows).
      // Using `buildShellPlaceholderPersonaName` instead of the literal
      // `'User 123456'` prevents silent drift if the prefix ever changes.
      expect(mockPrisma.persona.updateMany).toHaveBeenCalledWith({
        where: { ownerId: 'existing-user-id', name: buildShellPlaceholderPersonaName('123456') },
        data: { name: 'realusername', preferredName: 'realusername' },
      });
    });

    it('should use displayName for persona preferredName on placeholder upgrade', async () => {
      // The shell→full upgrade must propagate `displayName` into
      // `preferredName` to match the full-path create behavior — a user who
      // shell-created via HTTP and then first interacts via bot-client with
      // a distinct displayName would otherwise lose it on the rename.
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-id',
        isSuperuser: false,
        username: '123456', // Placeholder = discordId
        defaultPersonaId: 'existing-persona-id',
      });
      mockPrisma.user.update.mockResolvedValueOnce({ id: 'existing-user-id' });
      mockPrisma.persona.updateMany.mockResolvedValueOnce({ count: 1 });

      await userService.getOrCreateUser('123456', 'lbds137', 'LB');

      expect(mockPrisma.persona.updateMany).toHaveBeenCalledWith({
        where: { ownerId: 'existing-user-id', name: buildShellPlaceholderPersonaName('123456') },
        data: { name: 'lbds137', preferredName: 'LB' },
      });
    });

    it('should not update username if already set to real value', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-id',
        isSuperuser: false,
        username: 'alreadyset', // Real username, not a placeholder
        defaultPersonaId: 'existing-persona-id',
      });

      const result = await userService.getOrCreateUser('123456', 'newusername');

      expect(result?.userId).toBe('existing-user-id');
      // Should not update since username is not a placeholder
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should create new user with isSuperuser=false for regular users', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await userService.getOrCreateUser('123456', 'testuser');

      const call = decodeCreateUserCall(mockPrisma.$executeRaw.mock.calls[0]);
      // Cross-check that the decoded positional values landed on the right
      // slots — if the CTE template ever reorders columns or adds a new one,
      // these sentinels fail loud rather than silently pass with wrong data.
      expect(call?.discordId).toBe('123456');
      expect(call?.username).toBe('testuser');
      expect(call?.isSuperuser).toBe(false);
    });

    it('should create new user with isSuperuser=true when discordId matches BOT_OWNER_ID', async () => {
      process.env.BOT_OWNER_ID = '999888777';
      resetConfig();

      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await userService.getOrCreateUser('999888777', 'botowner');

      const call = decodeCreateUserCall(mockPrisma.$executeRaw.mock.calls[0]);
      expect(call?.isSuperuser).toBe(true);

      delete process.env.BOT_OWNER_ID;
    });

    it('should NOT promote user when discordId does not match BOT_OWNER_ID', async () => {
      process.env.BOT_OWNER_ID = '999888777';
      resetConfig();

      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await userService.getOrCreateUser('111222333', 'regularuser');

      const call = decodeCreateUserCall(mockPrisma.$executeRaw.mock.calls[0]);
      expect(call?.isSuperuser).toBe(false);

      delete process.env.BOT_OWNER_ID;
    });

    it('should promote EXISTING user to superuser when BOT_OWNER_ID matches', async () => {
      // Set BOT_OWNER_ID environment variable
      process.env.BOT_OWNER_ID = '999888777';
      resetConfig(); // Force config to reload

      // User exists but is NOT superuser
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-id',
        isSuperuser: false,
        username: 'botowner',
        defaultPersonaId: 'existing-persona-id',
      });

      // Mock update call
      mockPrisma.user.update = vi.fn().mockResolvedValue({ id: 'existing-user-id' });

      const result = await userService.getOrCreateUser('999888777', 'botowner');

      expect(result?.userId).toBe('existing-user-id');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'existing-user-id' },
        data: { isSuperuser: true },
      });

      // Cleanup
      delete process.env.BOT_OWNER_ID;
    });

    it('should NOT update existing user who is already superuser', async () => {
      // Set BOT_OWNER_ID environment variable
      process.env.BOT_OWNER_ID = '999888777';
      resetConfig(); // Force config to reload

      // User exists and IS already superuser
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-id',
        isSuperuser: true,
        username: 'botowner',
        defaultPersonaId: 'existing-persona-id',
      });

      // Mock update call
      mockPrisma.user.update = vi.fn();

      const result = await userService.getOrCreateUser('999888777', 'botowner');

      expect(result?.userId).toBe('existing-user-id');
      // Should NOT call update since already superuser
      expect(mockPrisma.user.update).not.toHaveBeenCalled();

      // Cleanup
      delete process.env.BOT_OWNER_ID;
    });

    it('should throw and log error when user-creation CTE fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$executeRaw.mockRejectedValueOnce(new Error('CTE failed'));

      await expect(userService.getOrCreateUser('123456', 'testuser')).rejects.toThrow('CTE failed');
    });

    it('should handle race condition with P2002 error', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      // Another request created the user between our findUnique and CTE;
      // P2002 fires from the users.discord_id unique constraint.
      mockPrisma.$executeRaw.mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: ['discord_id'] },
      });
      // Recovery path — fetch the now-existing user
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-uuid',
        isSuperuser: false,
        username: 'testuser',
        defaultPersonaId: 'persona-uuid',
      });

      const result = await userService.getOrCreateUser('123456', 'testuser');

      expect(result?.userId).toBe('existing-user-uuid');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should throw error if user not found after P2002', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$executeRaw.mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: ['discord_id'] },
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(userService.getOrCreateUser('123456', 'testuser')).rejects.toThrow(
        'User not found after P2002 error'
      );
    });

    it('should rethrow P2002 errors from unexpected targets (defense-in-depth)', async () => {
      // The full path matches target='discord_id' just like the shell path.
      // A P2002 from the persona `(owner_id, name)` constraint — or any
      // non-discord-id unique — must propagate, not be mis-classified as a
      // "user already exists" race and recovered.
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$executeRaw.mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: ['owner_id', 'name'] },
      });

      await expect(userService.getOrCreateUser('123456', 'testuser')).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('pins the user lookup select shape (the downstream field contract)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'user-uuid',
        isSuperuser: false,
        username: 'testuser',
        defaultPersonaId: 'persona-uuid',
      });

      await userService.getOrCreateUser('123456', 'testuser');

      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { discordId: '123456' },
        select: { id: true, isSuperuser: true, username: true, defaultPersonaId: true },
      });
    });

    it('rethrows a P2002 whose target only SUBSTRING-matches (element equality, not substring)', async () => {
      // 'legacy_discord_id' CONTAINS the call site's target 'discord_id' as a
      // substring — an includes()-style comparison would wrongly recover here;
      // element-granularity equality must rethrow.
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$executeRaw.mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: ['legacy_discord_id'] },
      });

      await expect(userService.getOrCreateUser('123456', 'testuser')).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('recovers when discord_id appears among MULTIPLE constraint columns (some, not every)', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$executeRaw.mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: ['tenant', 'discord_id'] },
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-uuid',
        isSuperuser: false,
        username: 'testuser',
        defaultPersonaId: 'persona-uuid',
      });

      const result = await userService.getOrCreateUser('123456', 'testuser');

      expect(result?.userId).toBe('existing-user-uuid');
    });

    it('recovers when meta.target is a plain string equal to the constraint', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$executeRaw.mockRejectedValueOnce({
        code: 'P2002',
        meta: { target: 'discord_id' },
      });
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-uuid',
        isSuperuser: false,
        username: 'testuser',
        defaultPersonaId: 'persona-uuid',
      });

      const result = await userService.getOrCreateUser('123456', 'testuser');

      expect(result?.userId).toBe('existing-user-uuid');
    });

    it('rethrows a P2002 carrying no meta.target when a target is required', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$executeRaw.mockRejectedValueOnce({ code: 'P2002', meta: {} });

      await expect(userService.getOrCreateUser('123456', 'testuser')).rejects.toMatchObject({
        code: 'P2002',
      });
    });

    it('rethrows a non-P2002 object error untouched', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$executeRaw.mockRejectedValueOnce({ code: 'P1001' });

      await expect(userService.getOrCreateUser('123456', 'testuser')).rejects.toMatchObject({
        code: 'P1001',
      });
    });

    it('should throw and log error on database error', async () => {
      mockPrisma.user.findUnique.mockRejectedValue(new Error('Database error'));

      await expect(userService.getOrCreateUser('123456', 'testuser')).rejects.toThrow(
        'Database error'
      );
    });

    it('should use display name for persona preferredName', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await userService.getOrCreateUser('123456', 'testuser', 'Test User Display');

      const call = decodeCreateUserCall(mockPrisma.$executeRaw.mock.calls[0]);
      expect(call?.personaPreferredName).toBe('Test User Display');
    });

    it('should use bio for persona content', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await userService.getOrCreateUser('123456', 'testuser', undefined, 'My bio text');

      const call = decodeCreateUserCall(mockPrisma.$executeRaw.mock.calls[0]);
      expect(call?.personaContent).toBe('My bio text');
    });

    it('should NOT call $executeRaw when user already has one', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-id',
        isSuperuser: false,
        username: 'testuser',
        defaultPersonaId: 'existing-persona-id',
      });

      const result = await userService.getOrCreateUser('123456', 'testuser');

      expect(result?.userId).toBe('existing-user-id');
      // Must not run the create-user CTE when the user already exists
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('should return null when isBot is true', async () => {
      const result = await userService.getOrCreateUser(
        'bot-123',
        'test-bot',
        undefined,
        undefined,
        true
      );

      expect(result).toBeNull();
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
    });

    it('should create user normally when isBot is false', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await userService.getOrCreateUser(
        '123456',
        'testuser',
        undefined,
        undefined,
        false
      );

      expect(result?.userId).toBe('test-user-uuid');
      expect(mockPrisma.user.findUnique).toHaveBeenCalled();
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });

    it('should create user normally when isBot is undefined', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const result = await userService.getOrCreateUser('123456', 'testuser');

      expect(result?.userId).toBe('test-user-uuid');
      expect(mockPrisma.user.findUnique).toHaveBeenCalled();
      expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
    });
  });

  describe('getUserTimezone', () => {
    it('should return user timezone when set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ timezone: 'America/New_York' });

      const result = await userService.getUserTimezone('user-123');

      expect(result).toBe('America/New_York');
      expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: 'user-123' },
        select: { timezone: true },
      });
    });

    it('should return UTC when user has no timezone set', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({ timezone: null });

      const result = await userService.getUserTimezone('user-123');

      expect(result).toBe('UTC');
    });

    it('should return UTC when user not found', async () => {
      mockPrisma.user.findUnique.mockResolvedValue(null);

      const result = await userService.getUserTimezone('user-123');

      expect(result).toBe('UTC');
    });

    it('should return UTC on database error', async () => {
      mockPrisma.user.findUnique.mockRejectedValue(new Error('Database error'));

      const result = await userService.getUserTimezone('user-123');

      expect(result).toBe('UTC');
    });
  });

  describe('getOrCreateUsersInBatch', () => {
    it('should filter out bots', async () => {
      // Mock getOrCreateUser via the service's dependency
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        isSuperuser: false,
        username: 'testuser',
        defaultPersonaId: 'persona-uuid',
      });

      const users = [
        { discordId: 'user1', username: 'alice', isBot: false },
        { discordId: 'bot1', username: 'testbot', isBot: true },
        { discordId: 'user2', username: 'bob', isBot: false },
      ];

      const result = await userService.getOrCreateUsersInBatch(users);

      // Only 2 users (not the bot)
      expect(result.size).toBe(2);
      expect(result.has('user1')).toBe(true);
      expect(result.has('user2')).toBe(true);
      expect(result.has('bot1')).toBe(false);
    });

    it('should filter out unknown user placeholder', async () => {
      mockPrisma.user.findUnique.mockResolvedValue({
        id: 'user-uuid',
        isSuperuser: false,
        username: 'testuser',
        defaultPersonaId: 'persona-uuid',
      });

      const users = [
        { discordId: 'user1', username: 'alice', isBot: false },
        { discordId: 'unknown', username: 'Unknown User', isBot: false }, // UNKNOWN_USER_DISCORD_ID
        { discordId: 'user2', username: 'bob', isBot: false },
      ];

      const result = await userService.getOrCreateUsersInBatch(users);

      // Only 2 users (not the unknown placeholder)
      expect(result.size).toBe(2);
      expect(result.has('user1')).toBe(true);
      expect(result.has('user2')).toBe(true);
      expect(result.has('unknown')).toBe(false);
    });

    it('should return empty map when all users are filtered', async () => {
      const users = [
        { discordId: 'bot1', username: 'bot1', isBot: true },
        { discordId: 'unknown', username: 'Unknown User', isBot: false },
      ];

      const result = await userService.getOrCreateUsersInBatch(users);

      expect(result.size).toBe(0);
      // Should not call database at all
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });

    it('should return map of discordId to userId', async () => {
      // Mock different user IDs for different Discord IDs
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'uuid-for-alice',
          isSuperuser: false,
          username: 'alice',
          defaultPersonaId: 'persona-uuid',
        })
        .mockResolvedValueOnce({
          id: 'uuid-for-bob',
          isSuperuser: false,
          username: 'bob',
          defaultPersonaId: 'persona-uuid',
        });

      const users = [
        { discordId: 'discord-alice', username: 'alice', isBot: false },
        { discordId: 'discord-bob', username: 'bob', isBot: false },
      ];

      const result = await userService.getOrCreateUsersInBatch(users);

      expect(result.get('discord-alice')).toBe('uuid-for-alice');
      expect(result.get('discord-bob')).toBe('uuid-for-bob');
    });

    it('should handle partial failures gracefully', async () => {
      // First user succeeds, second fails, third succeeds
      mockPrisma.user.findUnique
        .mockResolvedValueOnce({
          id: 'uuid-for-alice',
          isSuperuser: false,
          username: 'alice',
          defaultPersonaId: 'persona-uuid',
        })
        .mockRejectedValueOnce(new Error('Database error for bob'))
        .mockResolvedValueOnce({
          id: 'uuid-for-charlie',
          isSuperuser: false,
          username: 'charlie',
          defaultPersonaId: 'persona-uuid',
        });

      const users = [
        { discordId: 'alice-id', username: 'alice', isBot: false },
        { discordId: 'bob-id', username: 'bob', isBot: false },
        { discordId: 'charlie-id', username: 'charlie', isBot: false },
      ];

      const result = await userService.getOrCreateUsersInBatch(users);

      // Should have 2 successful users, bob failed silently
      expect(result.size).toBe(2);
      expect(result.has('alice-id')).toBe(true);
      expect(result.has('bob-id')).toBe(false);
      expect(result.has('charlie-id')).toBe(true);
    });

    it('should pass displayName to getOrCreateUser', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      const users = [
        { discordId: 'user1', username: 'alice', displayName: 'Alice Display', isBot: false },
      ];

      await userService.getOrCreateUsersInBatch(users);

      const call = decodeCreateUserCall(mockPrisma.$executeRaw.mock.calls[0]);
      expect(call?.personaPreferredName).toBe('Alice Display');
    });

    it('should return empty map for empty input', async () => {
      const result = await userService.getOrCreateUsersInBatch([]);

      expect(result.size).toBe(0);
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('getPersonaName', () => {
    it('should return preferredName when set', async () => {
      mockPrisma.persona.findUnique.mockResolvedValue({
        name: 'testuser',
        preferredName: 'Test User',
      });

      const result = await userService.getPersonaName('persona-123');

      expect(result).toBe('Test User');
      expect(mockPrisma.persona.findUnique).toHaveBeenCalledWith({
        where: { id: 'persona-123' },
        select: { name: true, preferredName: true },
      });
    });

    it('should return name when preferredName is null', async () => {
      mockPrisma.persona.findUnique.mockResolvedValue({
        name: 'testuser',
        preferredName: null,
      });

      const result = await userService.getPersonaName('persona-123');

      expect(result).toBe('testuser');
    });

    it('should return null when persona not found', async () => {
      mockPrisma.persona.findUnique.mockResolvedValue(null);

      const result = await userService.getPersonaName('persona-123');

      expect(result).toBeNull();
    });

    it('should return null on database error', async () => {
      mockPrisma.persona.findUnique.mockRejectedValue(new Error('Database error'));

      const result = await userService.getPersonaName('persona-123');

      expect(result).toBeNull();
    });
  });
});

describe('getOrCreateUserService registry', () => {
  // The WeakMap-backed registry's two load-bearing invariants: it MUST return
  // the SAME UserService instance for the same PrismaClient (so the TTLCache
  // inside UserService is shared across every caller — api-gateway's route
  // factories AND ai-worker's context pipeline — and an eviction on one is seen
  // by all), and DISTINCT instances for distinct PrismaClients (so short-lived
  // test-fixture clients don't pollute each other's caches). If the sharing
  // breaks, invalidateUser on the delete route would no longer reach the cache
  // the middleware reads, silently re-opening the stale-provisioning bug.

  it('returns the same UserService instance for the same PrismaClient', () => {
    const prisma = {} as unknown as PrismaClient;
    expect(getOrCreateUserService(prisma)).toBe(getOrCreateUserService(prisma));
  });

  it('returns distinct UserService instances for distinct PrismaClients', () => {
    const prisma1 = {} as unknown as PrismaClient;
    const prisma2 = {} as unknown as PrismaClient;
    expect(getOrCreateUserService(prisma1)).not.toBe(getOrCreateUserService(prisma2));
  });
});
