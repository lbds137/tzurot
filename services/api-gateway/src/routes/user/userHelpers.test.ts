/**
 * Tests for shared user helpers (getOrCreateInternalUser)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getOrCreateInternalUser } from './userHelpers.js';
import type { ProvisionedRequest } from '../../types.js';

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

  it('returns the provisioned UUIDs directly when middleware attached them (common path)', async () => {
    // Provisioned path: `requireProvisionedUser` middleware ran successfully
    // and attached both UUIDs. No DB lookups needed — the provisioned values
    // ARE the authoritative answer.
    const req = {
      userId: 'discord-123',
      provisionedUserId: 'user-uuid-from-middleware',
      provisionedDefaultPersonaId: 'persona-uuid-from-middleware',
    } as ProvisionedRequest;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock for Prisma client
    const result = await getOrCreateInternalUser(mockPrisma as any, req);

    expect(result).toEqual({
      id: 'user-uuid-from-middleware',
      defaultPersonaId: 'persona-uuid-from-middleware',
    });
    // Structural proof the provisioned path won: no DB round-trip.
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('returns null defaultPersonaId when middleware attached only userId', async () => {
    // Edge case: middleware can theoretically attach provisionedUserId without
    // provisionedDefaultPersonaId (getOrCreateUser always returns both today,
    // but the types are optional independently). Handle the edge gracefully.
    const req = {
      userId: 'discord-123',
      provisionedUserId: 'user-uuid-from-middleware',
    } as ProvisionedRequest;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock for Prisma client
    const result = await getOrCreateInternalUser(mockPrisma as any, req);

    expect(result).toEqual({
      id: 'user-uuid-from-middleware',
      defaultPersonaId: null,
    });
  });

  it('falls back to shell path when middleware fell through — existing user', async () => {
    // Shadow-mode fallthrough: middleware didn't attach provisionedUserId
    // (missing/malformed headers, bot user, rare getOrCreateUser failure).
    // Preserves the legacy behavior: shell-create then findUnique for persona.
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-123',
      username: 'existing-user',
      defaultPersonaId: 'persona-456',
      isSuperuser: false,
    });

    const req = { userId: 'discord-123' } as ProvisionedRequest;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock for Prisma client
    const result = await getOrCreateInternalUser(mockPrisma as any, req);

    expect(result).toEqual(
      expect.objectContaining({ id: 'user-123', defaultPersonaId: 'persona-456' })
    );
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it('falls back to shell path when middleware fell through — creates user via CTE', async () => {
    // Phase 5b: shell creation now atomically creates the user + a
    // placeholder persona via a single $executeRaw CTE. The follow-up
    // findUnique returns the freshly-created row with its non-null
    // default persona id.
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null) // UserService shell-path initial lookup
      .mockResolvedValueOnce({ id: 'test-user-uuid', defaultPersonaId: 'test-persona-uuid' });

    const req = { userId: 'discord-456' } as ProvisionedRequest;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock for Prisma client
    const result = await getOrCreateInternalUser(mockPrisma as any, req);

    expect(result).toEqual(
      expect.objectContaining({ id: 'test-user-uuid', defaultPersonaId: 'test-persona-uuid' })
    );
    // The create-user CTE must have run (single $executeRaw call).
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});
