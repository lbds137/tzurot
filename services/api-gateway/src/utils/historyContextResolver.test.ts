/**
 * Tests for History Context Resolver
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveHistoryContext } from './historyContextResolver.js';

// Mock logger
vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    PersonaResolver: vi.fn().mockImplementation(() => ({
      resolve: vi.fn(),
    })),
  };
});

describe('resolveHistoryContext', () => {
  let mockPrisma: {
    user: { findFirst: ReturnType<typeof vi.fn> };
    personality: { findUnique: ReturnType<typeof vi.fn> };
    persona: { findFirst: ReturnType<typeof vi.fn> };
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma = {
      user: { findFirst: vi.fn() },
      personality: { findUnique: vi.fn() },
      persona: { findFirst: vi.fn() },
    };
  });

  it('should return null if user not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    const result = await resolveHistoryContext(
      mockPrisma as never,
      'discord-123',
      'test-personality'
    );

    expect(result).toBeNull();
    expect(mockPrisma.personality.findUnique).not.toHaveBeenCalled();
  });

  it('should return null if personality not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
    mockPrisma.personality.findUnique.mockResolvedValue(null);

    const result = await resolveHistoryContext(
      mockPrisma as never,
      'discord-123',
      'unknown-personality'
    );

    expect(result).toBeNull();
  });

  it('should resolve with explicit persona ID', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
    mockPrisma.personality.findUnique.mockResolvedValue({ id: 'personality-1' });
    mockPrisma.persona.findFirst.mockResolvedValue({
      id: 'persona-1',
      name: 'Test Persona',
      ownerId: 'user-1',
    });

    const result = await resolveHistoryContext(
      mockPrisma as never,
      'discord-123',
      'test-personality',
      'persona-1'
    );

    expect(result).toEqual({
      userId: 'user-1',
      personalityId: 'personality-1',
      personaId: 'persona-1',
      personaName: 'Test Persona',
    });
  });

  it('should return null if explicit persona not found', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
    mockPrisma.personality.findUnique.mockResolvedValue({ id: 'personality-1' });
    mockPrisma.persona.findFirst.mockResolvedValue(null);

    const result = await resolveHistoryContext(
      mockPrisma as never,
      'discord-123',
      'test-personality',
      'invalid-persona'
    );

    expect(result).toBeNull();
  });

  it('should return null if explicit persona not owned by user', async () => {
    mockPrisma.user.findFirst.mockResolvedValue({ id: 'user-1' });
    mockPrisma.personality.findUnique.mockResolvedValue({ id: 'personality-1' });
    // Prisma query with ownerId filter returns null
    mockPrisma.persona.findFirst.mockResolvedValue(null);

    const result = await resolveHistoryContext(
      mockPrisma as never,
      'discord-123',
      'test-personality',
      'other-users-persona'
    );

    expect(result).toBeNull();
    expect(mockPrisma.persona.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'other-users-persona',
        ownerId: 'user-1',
      },
    });
  });
});
