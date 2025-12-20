import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { UserService } from './UserService.js';
import { resetConfig } from '../config/index.js';

// Mock dependencies
vi.mock('./prisma.js', () => ({
  Prisma: {
    TransactionClient: class {},
  },
}));

vi.mock('../utils/deterministicUuid.js', () => ({
  generateUserUuid: vi.fn().mockReturnValue('test-user-uuid'),
  generatePersonaUuid: vi.fn().mockReturnValue('test-persona-uuid'),
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    userService = new UserService(mockPrisma as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
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
