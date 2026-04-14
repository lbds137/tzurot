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

  it('should create shell user (no persona) if not found', async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null) // UserService shell lookup
      .mockResolvedValueOnce({ id: 'test-user-uuid', defaultPersonaId: null }); // Follow-up query — shell has null persona
    mockPrisma.user.create.mockResolvedValueOnce({ id: 'test-user-uuid' });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock for Prisma client
    const result = await getOrCreateInternalUser(mockPrisma as any, 'discord-456');

    // Shell user — no persona created, no transaction opened
    expect(result).toEqual({ id: 'test-user-uuid', defaultPersonaId: null });
    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        discordId: 'discord-456',
        username: 'discord-456', // placeholder until bot-client upgrades
      }),
    });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.persona.create).not.toHaveBeenCalled();
  });

  it('should return user even when defaultPersonaId is null', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'bot-id',
      username: 'bot-user',
      defaultPersonaId: null,
      isSuperuser: false,
      isBot: true,
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Test mock for Prisma client
    const result = await getOrCreateInternalUser(mockPrisma as any, 'discord-bot');
    expect(result).toEqual(expect.objectContaining({ id: 'bot-id', defaultPersonaId: null }));
  });
});
