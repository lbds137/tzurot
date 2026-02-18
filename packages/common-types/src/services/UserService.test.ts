import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserService } from './UserService.js';
import { resetConfig } from '../config/index.js';

// Use vi.hoisted() to create mocks that persist across test resets
const { mockGenerateUserUuid, mockGeneratePersonaUuid } = vi.hoisted(() => ({
  mockGenerateUserUuid: vi.fn(),
  mockGeneratePersonaUuid: vi.fn(),
}));

// Mock dependencies
vi.mock('./prisma.js', () => ({
  Prisma: {
    TransactionClient: class {},
  },
}));

vi.mock('../utils/deterministicUuid.js', () => ({
  DNS_NAMESPACE: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  generateUserUuid: mockGenerateUserUuid,
  generatePersonaUuid: mockGeneratePersonaUuid,
}));

describe('UserService', () => {
  let userService: UserService;
  let mockPrisma: {
    user: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
    };
    persona: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    userPersonalityConfig: {
      findUnique: ReturnType<typeof vi.fn>;
    };
    $transaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    // Set up deterministic UUID mock return values for each test
    mockGenerateUserUuid.mockReturnValue('test-user-uuid');
    mockGeneratePersonaUuid.mockReturnValue('test-persona-uuid');

    mockPrisma = {
      user: {
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      persona: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      userPersonalityConfig: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn(),
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock for Prisma client
    userService = new UserService(mockPrisma as any);
  });

  afterEach(() => {
    vi.clearAllMocks(); // Use clearAllMocks to preserve mock implementations
    resetConfig();
  });

  describe('getOrCreateUser', () => {
    it('should return cached user ID if available', async () => {
      // First call to populate cache
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'cached-user-id' });

      const result1 = await userService.getOrCreateUser('123456', 'testuser');
      expect(result1).toBe('cached-user-id');

      // Second call should use cache
      const result2 = await userService.getOrCreateUser('123456', 'testuser');
      expect(result2).toBe('cached-user-id');

      // findUnique should only be called once
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(1);
    });

    it('should return existing user ID if found in database', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-id',
        isSuperuser: false,
        username: 'existinguser',
        defaultPersonaId: 'existing-persona-id',
      });

      const result = await userService.getOrCreateUser('123456', 'testuser');

      expect(result).toBe('existing-user-id');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should update placeholder username when real username is provided', async () => {
      // User was created by api-gateway with discordId as placeholder username
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

      const result = await userService.getOrCreateUser('123456', 'realusername');

      expect(result).toBe('existing-user-id');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'existing-user-id' },
        data: { username: 'realusername' },
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

      expect(result).toBe('existing-user-id');
      // Should not update since username is not a placeholder
      expect(mockPrisma.user.update).not.toHaveBeenCalled();
    });

    it('should create new user with isSuperuser=false for regular users', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      // Mock transaction to capture the create call
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<void>) => {
          const mockTx = {
            user: {
              create: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
              update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
            },
            persona: {
              create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
            },
          };
          await callback(mockTx);

          // Verify isSuperuser was false
          expect(mockTx.user.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
              isSuperuser: false,
            }),
          });
        }
      );

      await userService.getOrCreateUser('123456', 'testuser');
    });

    it('should create new user with isSuperuser=true when discordId matches BOT_OWNER_ID', async () => {
      // Set BOT_OWNER_ID environment variable
      process.env.BOT_OWNER_ID = '999888777';
      resetConfig(); // Force config to reload

      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      // Mock transaction to capture the create call
      let capturedUserData: { isSuperuser?: boolean } | undefined;
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<void>) => {
          const mockTx = {
            user: {
              create: vi.fn().mockImplementation(({ data }) => {
                capturedUserData = data;
                return Promise.resolve({ id: 'test-user-uuid' });
              }),
              update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
            },
            persona: {
              create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
            },
          };
          await callback(mockTx);
        }
      );

      await userService.getOrCreateUser('999888777', 'botowner');

      expect(capturedUserData?.isSuperuser).toBe(true);

      // Cleanup
      delete process.env.BOT_OWNER_ID;
    });

    it('should NOT promote user when discordId does not match BOT_OWNER_ID', async () => {
      // Set BOT_OWNER_ID environment variable
      process.env.BOT_OWNER_ID = '999888777';
      resetConfig(); // Force config to reload

      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      // Mock transaction to capture the create call
      let capturedUserData: { isSuperuser?: boolean } | undefined;
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<void>) => {
          const mockTx = {
            user: {
              create: vi.fn().mockImplementation(({ data }) => {
                capturedUserData = data;
                return Promise.resolve({ id: 'test-user-uuid' });
              }),
              update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
            },
            persona: {
              create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
            },
          };
          await callback(mockTx);
        }
      );

      // Different Discord ID
      await userService.getOrCreateUser('111222333', 'regularuser');

      expect(capturedUserData?.isSuperuser).toBe(false);

      // Cleanup
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

      expect(result).toBe('existing-user-id');
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

      expect(result).toBe('existing-user-id');
      // Should NOT call update since already superuser
      expect(mockPrisma.user.update).not.toHaveBeenCalled();

      // Cleanup
      delete process.env.BOT_OWNER_ID;
    });

    it('should throw and log error when transaction fails', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$transaction.mockRejectedValue(new Error('Transaction failed'));

      await expect(userService.getOrCreateUser('123456', 'testuser')).rejects.toThrow(
        'Transaction failed'
      );
    });

    it('should handle race condition with P2002 error', async () => {
      // First findUnique returns null (user doesn't exist)
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      // Transaction fails with P2002 (another request created the user)
      mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });
      // Second findUnique returns the user created by the other request
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-uuid',
        isSuperuser: false,
        username: 'testuser',
        defaultPersonaId: 'persona-uuid',
      });

      const result = await userService.getOrCreateUser('123456', 'testuser');

      expect(result).toBe('existing-user-uuid');
      // Should have called findUnique twice (initial check + after P2002)
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
    });

    it('should throw error if user not found after P2002', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$transaction.mockRejectedValueOnce({ code: 'P2002' });
      // User somehow doesn't exist after P2002 (shouldn't happen in practice)
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      await expect(userService.getOrCreateUser('123456', 'testuser')).rejects.toThrow(
        'User not found after P2002 error'
      );
    });

    it('should throw and log error on database error', async () => {
      mockPrisma.user.findUnique.mockRejectedValue(new Error('Database error'));

      await expect(userService.getOrCreateUser('123456', 'testuser')).rejects.toThrow(
        'Database error'
      );
    });

    it('should use display name for persona preferredName', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      let capturedPersonaData: { preferredName?: string } | undefined;
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<void>) => {
          const mockTx = {
            user: {
              create: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
              update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
            },
            persona: {
              create: vi.fn().mockImplementation(({ data }) => {
                capturedPersonaData = data;
                return Promise.resolve({ id: 'test-persona-uuid' });
              }),
            },
          };
          await callback(mockTx);
        }
      );

      await userService.getOrCreateUser('123456', 'testuser', 'Test User Display');

      expect(capturedPersonaData?.preferredName).toBe('Test User Display');
    });

    it('should use bio for persona content', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      let capturedPersonaData: { content?: string } | undefined;
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<void>) => {
          const mockTx = {
            user: {
              create: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
              update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
            },
            persona: {
              create: vi.fn().mockImplementation(({ data }) => {
                capturedPersonaData = data;
                return Promise.resolve({ id: 'test-persona-uuid' });
              }),
            },
          };
          await callback(mockTx);
        }
      );

      await userService.getOrCreateUser('123456', 'testuser', undefined, 'My bio text');

      expect(capturedPersonaData?.content).toBe('My bio text');
    });

    it('should backfill default persona when user exists without one', async () => {
      // User was created by api-gateway without a default persona
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-id',
        isSuperuser: false,
        username: 'testuser',
        defaultPersonaId: null, // No default persona!
      });

      // Create mock functions to track calls
      const mockPersonaCreate = vi.fn().mockResolvedValue({ id: 'test-persona-uuid' });
      const mockUserUpdateMany = vi.fn().mockResolvedValue({ count: 1 });

      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<void>) => {
          const mockTx = {
            persona: { create: mockPersonaCreate },
            user: {
              findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }), // Still needs backfill
              updateMany: mockUserUpdateMany,
            },
          };
          await callback(mockTx);
        }
      );

      const result = await userService.getOrCreateUser(
        '123456',
        'testuser',
        'Test Display Name',
        'User bio'
      );

      expect(result).toBe('existing-user-id');
      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockPersonaCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          preferredName: 'Test Display Name',
          content: 'User bio',
          name: 'testuser',
          ownerId: 'existing-user-id',
        }),
      });
      // Uses updateMany with idempotent where clause to prevent TOCTOU race
      expect(mockUserUpdateMany).toHaveBeenCalledWith({
        where: { id: 'existing-user-id', defaultPersonaId: null },
        data: { defaultPersonaId: 'test-persona-uuid' },
      });
    });

    it('should NOT backfill persona when user already has one', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: 'existing-user-id',
        isSuperuser: false,
        username: 'testuser',
        defaultPersonaId: 'existing-persona-id', // Already has a persona
      });

      const result = await userService.getOrCreateUser('123456', 'testuser');

      expect(result).toBe('existing-user-id');
      // Should NOT call $transaction since persona already exists
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
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
      // Should NOT call any database operations for bots
      expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should create user normally when isBot is false', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<void>) => {
          const mockTx = {
            user: {
              create: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
              update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
            },
            persona: {
              create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
            },
          };
          await callback(mockTx);
        }
      );

      const result = await userService.getOrCreateUser(
        '123456',
        'testuser',
        undefined,
        undefined,
        false
      );

      expect(result).toBe('test-user-uuid');
      expect(mockPrisma.user.findUnique).toHaveBeenCalled();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
    });

    it('should create user normally when isBot is undefined', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<void>) => {
          const mockTx = {
            user: {
              create: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
              update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
            },
            persona: {
              create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
            },
          };
          await callback(mockTx);
        }
      );

      // Not passing isBot parameter at all (undefined)
      const result = await userService.getOrCreateUser('123456', 'testuser');

      expect(result).toBe('test-user-uuid');
      expect(mockPrisma.user.findUnique).toHaveBeenCalled();
      expect(mockPrisma.$transaction).toHaveBeenCalled();
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

      let capturedPersonaData: { preferredName?: string } | undefined;
      mockPrisma.$transaction.mockImplementation(
        async (callback: (tx: unknown) => Promise<void>) => {
          const mockTx = {
            user: {
              create: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
              update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
            },
            persona: {
              create: vi.fn().mockImplementation(({ data }) => {
                capturedPersonaData = data;
                return Promise.resolve({ id: 'test-persona-uuid' });
              }),
            },
          };
          await callback(mockTx);
        }
      );

      const users = [
        { discordId: 'user1', username: 'alice', displayName: 'Alice Display', isBot: false },
      ];

      await userService.getOrCreateUsersInBatch(users);

      expect(capturedPersonaData?.preferredName).toBe('Alice Display');
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
