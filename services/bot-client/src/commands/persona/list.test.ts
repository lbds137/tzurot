/**
 * Tests for Persona List Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleListPersonas } from './list.js';
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

describe('handleListPersonas', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction() {
    return {
      user: { id: '123456789', username: 'testuser' },
      reply: mockReply,
    } as any;
  }

  it('should show empty state when user has no personas', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [],
    });

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have any personas yet"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show empty state when user not found', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have any personas yet"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should list user personas with embed', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: 'persona-1',
      ownedPersonas: [
        {
          id: 'persona-1',
          name: 'Default Persona',
          preferredName: 'Alice',
          pronouns: 'she/her',
          content: 'I love coding',
          createdAt: new Date(),
        },
        {
          id: 'persona-2',
          name: 'Work Persona',
          preferredName: 'Professional Alice',
          pronouns: null,
          content: null,
          createdAt: new Date(),
        },
      ],
    });

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            title: '📋 Your Personas',
          }),
        }),
      ]),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should mark default persona with star', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: 'persona-1',
      ownedPersonas: [
        {
          id: 'persona-1',
          name: 'My Persona',
          preferredName: null,
          pronouns: null,
          content: null,
          createdAt: new Date(),
        },
      ],
    });

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalled();
    const call = mockReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    // The field name should contain star for default
    expect(embed.fields[0].name).toContain('⭐');
    expect(embed.fields[0].name).toContain('(default)');
  });

  it('should show persona count in description', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [
        {
          id: 'persona-1',
          name: 'Persona 1',
          preferredName: null,
          pronouns: null,
          content: null,
          createdAt: new Date(),
        },
        {
          id: 'persona-2',
          name: 'Persona 2',
          preferredName: null,
          pronouns: null,
          content: null,
          createdAt: new Date(),
        },
        {
          id: 'persona-3',
          name: 'Persona 3',
          preferredName: null,
          pronouns: null,
          content: null,
          createdAt: new Date(),
        },
      ],
    });

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalled();
    const call = mockReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    expect(embed.description).toContain('3');
    expect(embed.description).toContain('personas');
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('DB error'));

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to load'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should truncate long content in preview', async () => {
    const longContent = 'x'.repeat(200);
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersonaId: null,
      ownedPersonas: [
        {
          id: 'persona-1',
          name: 'Long Content Persona',
          preferredName: null,
          pronouns: null,
          content: longContent,
          createdAt: new Date(),
        },
      ],
    });

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalled();
    const call = mockReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    expect(embed.fields[0].value).toContain('...');
  });
});
