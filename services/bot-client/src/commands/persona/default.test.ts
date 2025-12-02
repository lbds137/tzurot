/**
 * Tests for Persona Default Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetDefaultPersona } from './default.js';
import { MessageFlags } from 'discord.js';

// Mock Prisma
const mockPrismaClient = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  persona: {
    findFirst: vi.fn(),
  },
};

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    getPrismaClient: vi.fn(() => mockPrismaClient),
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

// Mock redis
vi.mock('../../redis.js', () => ({
  personaCacheInvalidationService: {
    invalidateUserPersona: vi.fn().mockResolvedValue(undefined),
    invalidateAll: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('handleSetDefaultPersona', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(personaId: string) {
    return {
      user: { id: '123456789', username: 'testuser' },
      options: {
        getString: (name: string, required: boolean) => {
          if (name === 'persona') return personaId;
          return null;
        },
      },
      reply: mockReply,
    } as any;
  }

  it('should set persona as default', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'old-persona',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue({
      id: 'persona-123',
      name: 'Work Persona',
      preferredName: 'Alice',
    });
    mockPrismaClient.user.update.mockResolvedValue({});

    await handleSetDefaultPersona(createMockInteraction('persona-123'));

    expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
      where: { id: 'user-uuid' },
      data: { defaultPersonaId: 'persona-123' },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Alice'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('now your default'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should use persona name if no preferredName', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'old-persona',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue({
      id: 'persona-123',
      name: 'Work Persona',
      preferredName: null,
    });
    mockPrismaClient.user.update.mockResolvedValue({});

    await handleSetDefaultPersona(createMockInteraction('persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Work Persona'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should error if user not found', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    await handleSetDefaultPersona(createMockInteraction('persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account yet"),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
  });

  it('should error if persona not found or not owned', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'old-persona',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue(null);

    await handleSetDefaultPersona(createMockInteraction('nonexistent-persona'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona not found'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
  });

  it('should inform user if persona is already default', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'persona-123',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue({
      id: 'persona-123',
      name: 'My Persona',
      preferredName: 'Alice',
    });

    await handleSetDefaultPersona(createMockInteraction('persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already your default'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
  });

  it('should verify persona ownership', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: null,
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue(null); // Not found = not owned

    await handleSetDefaultPersona(createMockInteraction('other-users-persona'));

    expect(mockPrismaClient.persona.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'other-users-persona',
        ownerId: 'user-uuid',
      },
      select: expect.any(Object),
    });
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('DB error'));

    await handleSetDefaultPersona(createMockInteraction('persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to set default'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
