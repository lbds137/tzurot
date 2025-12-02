/**
 * Tests for Persona View Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleViewPersona } from './view.js';
import { MessageFlags } from 'discord.js';

// Mock Prisma
const mockPrismaClient = {
  user: {
    findUnique: vi.fn(),
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

describe('handleViewPersona', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction() {
    return {
      user: { id: '123456789' },
      reply: mockReply,
    } as any;
  }

  it('should show error when user has no account', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    await handleViewPersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show error when user has no persona', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-123',
      defaultPersona: null,
    });

    await handleViewPersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have a persona"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should display persona with all fields', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-123',
      defaultPersona: {
        id: 'persona-123',
        name: 'Test Persona',
        preferredName: 'TestUser',
        pronouns: 'they/them',
        content: 'I am a test user who loves programming',
        description: 'Test description',
        shareLtmAcrossPersonalities: false,
      },
    });

    await handleViewPersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🎭 Your Persona',
          }),
        }),
      ],
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show LTM sharing enabled when flag is true', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-123',
      defaultPersona: {
        id: 'persona-123',
        name: 'Test Persona',
        preferredName: null,
        pronouns: null,
        content: '',
        description: null,
        shareLtmAcrossPersonalities: true,
      },
    });

    await handleViewPersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalled();
    const call = mockReply.mock.calls[0][0];
    const embed = call.embeds[0];
    const fields = embed.data.fields;
    const ltmField = fields.find((f: { name: string }) => f.name.includes('LTM'));

    expect(ltmField?.value).toContain('Enabled');
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('DB error'));

    await handleViewPersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to retrieve'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
