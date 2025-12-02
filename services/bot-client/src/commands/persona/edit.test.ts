/**
 * Tests for Persona Edit Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEditPersona, handleEditModalSubmit } from './edit.js';
import { MessageFlags } from 'discord.js';

// Mock Prisma
const mockPrismaClient = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  persona: {
    create: vi.fn(),
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

describe('handleEditPersona', () => {
  const mockShowModal = vi.fn();
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockShowModal.mockResolvedValue(undefined);
  });

  function createMockInteraction() {
    return {
      user: { id: '123456789', username: 'testuser' },
      showModal: mockShowModal,
      reply: mockReply,
    } as any;
  }

  it('should show modal with empty fields for user with no persona', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersona: null,
    });

    await handleEditPersona(createMockInteraction());

    expect(mockShowModal).toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('should show modal with existing persona values', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersona: {
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'I love coding',
      },
    });

    await handleEditPersona(createMockInteraction());

    expect(mockShowModal).toHaveBeenCalled();
  });

  it('should handle null persona fields gracefully', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersona: {
        preferredName: null,
        pronouns: null,
        content: null,
      },
    });

    await handleEditPersona(createMockInteraction());

    expect(mockShowModal).toHaveBeenCalled();
  });

  it('should handle long content in pre-fill', async () => {
    const longContent = 'x'.repeat(5000); // Exceeds modal limit
    mockPrismaClient.user.findUnique.mockResolvedValue({
      defaultPersona: {
        preferredName: 'Bob',
        pronouns: 'he/him',
        content: longContent,
      },
    });

    await handleEditPersona(createMockInteraction());

    expect(mockShowModal).toHaveBeenCalled();
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('DB error'));

    await handleEditPersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to open edit dialog'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockShowModal).not.toHaveBeenCalled();
  });

  it('should handle user not found in database', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    await handleEditPersona(createMockInteraction());

    expect(mockShowModal).toHaveBeenCalled();
  });
});

describe('handleEditModalSubmit', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockModalInteraction(fields: Record<string, string>) {
    return {
      user: { id: '123456789', username: 'testuser' },
      fields: {
        getTextInputValue: (name: string) => fields[name] ?? '',
      },
      reply: mockReply,
    } as any;
  }

  it('should update existing persona', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'persona-123',
    });
    mockPrismaClient.persona.update.mockResolvedValue({});

    await handleEditModalSubmit(
      createMockModalInteraction({
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'I love coding',
      })
    );

    expect(mockPrismaClient.persona.update).toHaveBeenCalledWith({
      where: { id: 'persona-123' },
      data: {
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'I love coding',
        updatedAt: expect.any(Date),
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona updated'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should create new persona for user without one', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: null,
    });
    mockPrismaClient.persona.create.mockResolvedValue({ id: 'new-persona-123' });
    mockPrismaClient.user.update.mockResolvedValue({});

    await handleEditModalSubmit(
      createMockModalInteraction({
        preferredName: 'Bob',
        pronouns: 'he/him',
        content: 'Test content',
      })
    );

    expect(mockPrismaClient.persona.create).toHaveBeenCalledWith({
      data: {
        name: "testuser's Persona",
        preferredName: 'Bob',
        pronouns: 'he/him',
        content: 'Test content',
        ownerId: 'user-uuid',
      },
    });
    expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
      where: { id: 'user-uuid' },
      data: { defaultPersonaId: 'new-persona-123' },
    });
  });

  it('should create user if they do not exist', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);
    mockPrismaClient.user.create.mockResolvedValue({
      id: 'new-user-uuid',
      defaultPersonaId: null,
    });
    mockPrismaClient.persona.create.mockResolvedValue({ id: 'new-persona-123' });
    mockPrismaClient.user.update.mockResolvedValue({});

    await handleEditModalSubmit(
      createMockModalInteraction({
        preferredName: 'NewUser',
        pronouns: '',
        content: '',
      })
    );

    expect(mockPrismaClient.user.create).toHaveBeenCalledWith({
      data: {
        discordId: '123456789',
        username: 'testuser',
      },
      select: {
        id: true,
        defaultPersonaId: true,
      },
    });
  });

  it('should handle empty fields by setting them to null', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'persona-123',
    });
    mockPrismaClient.persona.update.mockResolvedValue({});

    await handleEditModalSubmit(
      createMockModalInteraction({
        preferredName: '',
        pronouns: '',
        content: '',
      })
    );

    expect(mockPrismaClient.persona.update).toHaveBeenCalledWith({
      where: { id: 'persona-123' },
      data: {
        preferredName: null,
        pronouns: null,
        content: '',
        updatedAt: expect.any(Date),
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('All fields cleared'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should trim whitespace from fields', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'persona-123',
    });
    mockPrismaClient.persona.update.mockResolvedValue({});

    await handleEditModalSubmit(
      createMockModalInteraction({
        preferredName: '  Alice  ',
        pronouns: ' she/her ',
        content: '  content with spaces  ',
      })
    );

    expect(mockPrismaClient.persona.update).toHaveBeenCalledWith({
      where: { id: 'persona-123' },
      data: {
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'content with spaces',
        updatedAt: expect.any(Date),
      },
    });
  });

  it('should truncate long content in response message', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'persona-123',
    });
    mockPrismaClient.persona.update.mockResolvedValue({});

    const longContent = 'x'.repeat(200);
    await handleEditModalSubmit(
      createMockModalInteraction({
        preferredName: 'Test',
        pronouns: '',
        content: longContent,
      })
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('...'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('DB error'));

    await handleEditModalSubmit(
      createMockModalInteraction({
        preferredName: 'Test',
        pronouns: '',
        content: '',
      })
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to save'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
