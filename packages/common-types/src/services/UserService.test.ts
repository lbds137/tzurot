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
    };
    persona: {
      findUnique: ReturnType<typeof vi.fn>;
      create: ReturnType<typeof vi.fn>;
    };
    userDefaultPersona: {
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
      },
      persona: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      userDefaultPersona: {
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
      mockPrisma.user.findUnique.mockResolvedValueOnce({ id: 'existing-user-id' });

      const result = await userService.getOrCreateUser('123456', 'testuser');

      expect(result).toBe('existing-user-id');
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('should create new user with isSuperuser=false for regular users', async () => {
      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      // Mock transaction to capture the create call
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
        const mockTx = {
          user: {
            create: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
          },
          persona: {
            create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
          },
          userDefaultPersona: {
            create: vi.fn().mockResolvedValue({}),
          },
        };
        await callback(mockTx);

        // Verify isSuperuser was false
        expect(mockTx.user.create).toHaveBeenCalledWith({
          data: expect.objectContaining({
            isSuperuser: false,
          }),
        });
      });

      await userService.getOrCreateUser('123456', 'testuser');
    });

    it('should create new user with isSuperuser=true when discordId matches BOT_OWNER_ID', async () => {
      // Set BOT_OWNER_ID environment variable
      process.env.BOT_OWNER_ID = '999888777';
      resetConfig(); // Force config to reload

      mockPrisma.user.findUnique.mockResolvedValueOnce(null);

      // Mock transaction to capture the create call
      let capturedUserData: { isSuperuser?: boolean } | undefined;
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
        const mockTx = {
          user: {
            create: vi.fn().mockImplementation(({ data }) => {
              capturedUserData = data;
              return Promise.resolve({ id: 'test-user-uuid' });
            }),
          },
          persona: {
            create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
          },
          userDefaultPersona: {
            create: vi.fn().mockResolvedValue({}),
          },
        };
        await callback(mockTx);
      });

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
      mockPrisma.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
        const mockTx = {
          user: {
            create: vi.fn().mockImplementation(({ data }) => {
              capturedUserData = data;
              return Promise.resolve({ id: 'test-user-uuid' });
            }),
          },
          persona: {
            create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
          },
          userDefaultPersona: {
            create: vi.fn().mockResolvedValue({}),
          },
        };
        await callback(mockTx);
      });

      // Different Discord ID
      await userService.getOrCreateUser('111222333', 'regularuser');

      expect(capturedUserData?.isSuperuser).toBe(false);

      // Cleanup
      delete process.env.BOT_OWNER_ID;
    });
  });
});
