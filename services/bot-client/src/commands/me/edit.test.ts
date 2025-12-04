/**
 * Tests for Profile Edit Handler
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
    findFirst: vi.fn(),
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

// Mock redis module to provide personaCacheInvalidationService
vi.mock('../../redis.js', () => ({
  personaCacheInvalidationService: {
    invalidateUserPersona: vi.fn().mockResolvedValue(undefined),
    invalidateAll: vi.fn().mockResolvedValue(undefined),
  },
}));

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
      id: 'user-uuid',
      defaultPersonaId: null,
    });

    await handleEditPersona(createMockInteraction());

    expect(mockShowModal).toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('should show modal with existing persona values when editing default', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'persona-123',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue({
      id: 'persona-123',
      name: 'My Persona',
      description: 'My main persona',
      preferredName: 'Alice',
      pronouns: 'she/her',
      content: 'I love coding',
    });

    await handleEditPersona(createMockInteraction());

    expect(mockPrismaClient.persona.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'persona-123',
        ownerId: 'user-uuid',
      },
      select: {
        id: true,
        name: true,
        description: true,
        preferredName: true,
        pronouns: true,
        content: true,
      },
    });
    expect(mockShowModal).toHaveBeenCalled();
  });

  it('should show modal for specific persona when personaId provided', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'persona-123',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue({
      id: 'specific-persona',
      name: 'Work Persona',
      preferredName: 'Bob',
      pronouns: 'he/him',
      content: 'Work stuff',
    });

    await handleEditPersona(createMockInteraction(), 'specific-persona');

    expect(mockPrismaClient.persona.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'specific-persona',
        ownerId: 'user-uuid',
      },
      select: expect.any(Object),
    });
    expect(mockShowModal).toHaveBeenCalled();
  });

  it('should show error when specific profile not found', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'persona-123',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue(null);

    await handleEditPersona(createMockInteraction(), 'nonexistent-persona');

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile not found'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockShowModal).not.toHaveBeenCalled();
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
    mockPrismaClient.persona.findFirst.mockResolvedValue({
      id: 'persona-123',
      name: 'Old Name',
    });
    mockPrismaClient.persona.update.mockResolvedValue({});

    await handleEditModalSubmit(
      createMockModalInteraction({
        personaName: 'My Persona',
        description: 'Main persona',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'I love coding',
      }),
      'persona-123'
    );

    expect(mockPrismaClient.persona.update).toHaveBeenCalledWith({
      where: { id: 'persona-123' },
      data: {
        name: 'My Persona',
        description: 'Main persona',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'I love coding',
        updatedAt: expect.any(Date),
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile updated'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should create new persona when personaId is "new"', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: null,
    });
    mockPrismaClient.persona.create.mockResolvedValue({ id: 'new-persona-123' });
    mockPrismaClient.user.update.mockResolvedValue({});

    await handleEditModalSubmit(
      createMockModalInteraction({
        personaName: 'New Persona',
        description: 'Brand new',
        preferredName: 'Bob',
        pronouns: 'he/him',
        content: 'Test content',
      }),
      'new'
    );

    expect(mockPrismaClient.persona.create).toHaveBeenCalledWith({
      data: {
        name: 'New Persona',
        description: 'Brand new',
        preferredName: 'Bob',
        pronouns: 'he/him',
        content: 'Test content',
        ownerId: 'user-uuid',
      },
    });
    // Should set as default since user had no default
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
        personaName: 'First Persona',
        description: '',
        preferredName: 'NewUser',
        pronouns: '',
        content: '',
      }),
      'new'
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

  it('should handle empty optional fields', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'persona-123',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue({ id: 'persona-123' });
    mockPrismaClient.persona.update.mockResolvedValue({});

    await handleEditModalSubmit(
      createMockModalInteraction({
        personaName: 'My Persona',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      }),
      'persona-123'
    );

    expect(mockPrismaClient.persona.update).toHaveBeenCalledWith({
      where: { id: 'persona-123' },
      data: {
        name: 'My Persona',
        description: null,
        preferredName: null,
        pronouns: null,
        content: '',
        updatedAt: expect.any(Date),
      },
    });
  });

  it('should require profile name', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'persona-123',
    });

    await handleEditModalSubmit(
      createMockModalInteraction({
        personaName: '',
        description: '',
        preferredName: 'Alice',
        pronouns: '',
        content: '',
      }),
      'persona-123'
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile name is required'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockPrismaClient.persona.update).not.toHaveBeenCalled();
  });

  it('should trim whitespace from fields', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'persona-123',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue({ id: 'persona-123' });
    mockPrismaClient.persona.update.mockResolvedValue({});

    await handleEditModalSubmit(
      createMockModalInteraction({
        personaName: '  My Persona  ',
        description: '  Main persona  ',
        preferredName: '  Alice  ',
        pronouns: ' she/her ',
        content: '  content with spaces  ',
      }),
      'persona-123'
    );

    expect(mockPrismaClient.persona.update).toHaveBeenCalledWith({
      where: { id: 'persona-123' },
      data: {
        name: 'My Persona',
        description: 'Main persona',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'content with spaces',
        updatedAt: expect.any(Date),
      },
    });
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('DB error'));

    await handleEditModalSubmit(
      createMockModalInteraction({
        personaName: 'Test',
        description: '',
        preferredName: 'Test',
        pronouns: '',
        content: '',
      }),
      'persona-123'
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to save'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should error if trying to update non-owned profile', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'persona-123',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue(null); // Not found = not owned

    await handleEditModalSubmit(
      createMockModalInteraction({
        personaName: 'Test',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      }),
      'other-persona-id'
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile not found'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockPrismaClient.persona.update).not.toHaveBeenCalled();
  });
});
