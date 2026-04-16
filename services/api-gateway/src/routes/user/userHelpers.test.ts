/**
 * Tests for shared user helpers (getOrCreateInternalUser)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateInternalUser } from './userHelpers.js';

describe('getOrCreateInternalUser', () => {
  // Mock Prisma with UserService dependencies
  const mockPrisma = {
    user: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    persona: {
      create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
    $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
      const mockTx = {
        user: {
          create: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
          update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }),
        },
        persona: {
          create: vi.fn().mockResolvedValue({ id: 'test-persona-uuid' }),
        },
      };
      await callback(mockTx);
    }),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return existing user with defaultPersonaId', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      username: 'existing-user',
      defaultPersonaId: 'persona-456',
      isSuperuser: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock for Prisma client
    const result = await getOrCreateInternalUser(mockPrisma as any, 'discord-123');

    expect(result).toEqual(
      expect.objectContaining({ id: 'user-123', defaultPersonaId: 'persona-456' })
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('should create shell user with placeholder persona if not found', async () => {
    // Phase 5b: shell creation now atomically creates the user + a
    // placeholder persona via a single $executeRaw CTE. The follow-up
    // findUnique returns the freshly-created row with its non-null
    // default persona id.
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null) // UserService shell-path initial lookup
      .mockResolvedValueOnce({ id: 'test-user-uuid', defaultPersonaId: 'test-persona-uuid' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock for Prisma client
    const result = await getOrCreateInternalUser(mockPrisma as any, 'discord-456');

    expect(result).toEqual(
      expect.objectContaining({ id: 'test-user-uuid', defaultPersonaId: 'test-persona-uuid' })
    );
    // The create-user CTE must have run (single $executeRaw call).
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
