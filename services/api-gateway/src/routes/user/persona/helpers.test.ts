/**
 * Tests for persona route helpers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateInternalUser } from './helpers.js';

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
    $transaction: vi.fn().mockImplementation(async (callback: (tx: unknown) => Promise<void>) => {
      const mockTx = {
        user: {
          create: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }),
          update: vi.fn().mockResolvedValue({ id: 'test-user-uuid' }), // For new user creation
          updateMany: vi.fn().mockResolvedValue({ count: 1 }), // Idempotent backfill
          findUnique: vi.fn().mockResolvedValue({ defaultPersonaId: null }), // For backfill check
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

  it('should return existing user if found', async () => {
    // UserService uses findUnique, not findFirst
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      username: 'existing-user',
      defaultPersonaId: 'persona-456',
      isSuperuser: false,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock for Prisma client
    const result = await getOrCreateInternalUser(mockPrisma as any, 'discord-123');

    // Result includes id and defaultPersonaId from follow-up query
    expect(result).toEqual(
      expect.objectContaining({ id: 'user-123', defaultPersonaId: 'persona-456' })
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('should create new user if not found', async () => {
    // User doesn't exist - UserService will create via $transaction
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null) // First call for UserService lookup
      .mockResolvedValueOnce({ id: 'test-user-uuid', defaultPersonaId: 'test-persona-uuid' }); // Second call for result

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock for Prisma client
    const result = await getOrCreateInternalUser(mockPrisma as any, 'discord-456');

    // UserService creates user with deterministic UUID via $transaction
    expect(result).toEqual({ id: 'test-user-uuid', defaultPersonaId: 'test-persona-uuid' });
    expect(mockPrisma.$transaction).toHaveBeenCalled();
  });
});
