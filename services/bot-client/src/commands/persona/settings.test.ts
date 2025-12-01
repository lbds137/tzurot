/**
 * Tests for Persona Settings Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleShareLtmSetting } from './settings.js';
import { MessageFlags } from 'discord.js';

// Mock Prisma
const mockPrismaClient = {
  user: {
    findUnique: vi.fn(),
  },
  persona: {
    update: vi.fn(),
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

describe('handleShareLtmSetting', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(enabled: 'enable' | 'disable') {
    return {
      user: { id: '123456789' },
      options: {
        getString: (name: string, _required: boolean) => {
          if (name === 'enabled') return enabled;
          return null;
        },
      },
      reply: mockReply,
    } as any;
  }

  it('should show error when user has no account', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    await handleShareLtmSetting(createMockInteraction('enable'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show error when user has no persona', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-123',
      defaultPersonaLink: null,
    });

    await handleShareLtmSetting(createMockInteraction('enable'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have a persona"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show info message when already in desired state (enable)', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-123',
      defaultPersonaLink: {
        personaId: 'persona-123',
        persona: {
          shareLtmAcrossPersonalities: true,
        },
      },
    });

    await handleShareLtmSetting(createMockInteraction('enable'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already sharing'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockPrismaClient.persona.update).not.toHaveBeenCalled();
  });

  it('should show info message when already in desired state (disable)', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-123',
      defaultPersonaLink: {
        personaId: 'persona-123',
        persona: {
          shareLtmAcrossPersonalities: false,
        },
      },
    });

    await handleShareLtmSetting(createMockInteraction('disable'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already keeping'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockPrismaClient.persona.update).not.toHaveBeenCalled();
  });

  it('should enable LTM sharing', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-123',
      defaultPersonaLink: {
        personaId: 'persona-123',
        persona: {
          shareLtmAcrossPersonalities: false,
        },
      },
    });
    mockPrismaClient.persona.update.mockResolvedValue({});

    await handleShareLtmSetting(createMockInteraction('enable'));

    expect(mockPrismaClient.persona.update).toHaveBeenCalledWith({
      where: { id: 'persona-123' },
      data: {
        shareLtmAcrossPersonalities: true,
        updatedAt: expect.any(Date),
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('LTM sharing enabled'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should disable LTM sharing', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-123',
      defaultPersonaLink: {
        personaId: 'persona-123',
        persona: {
          shareLtmAcrossPersonalities: true,
        },
      },
    });
    mockPrismaClient.persona.update.mockResolvedValue({});

    await handleShareLtmSetting(createMockInteraction('disable'));

    expect(mockPrismaClient.persona.update).toHaveBeenCalledWith({
      where: { id: 'persona-123' },
      data: {
        shareLtmAcrossPersonalities: false,
        updatedAt: expect.any(Date),
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('LTM sharing disabled'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('DB error'));

    await handleShareLtmSetting(createMockInteraction('enable'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to update'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
