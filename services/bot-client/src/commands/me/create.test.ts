/**
 * Tests for Profile Create Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCreatePersona, handleCreateModalSubmit } from './create.js';
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

describe('handleCreatePersona', () => {
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

  it('should show create modal', async () => {
    await handleCreatePersona(createMockInteraction());

    expect(mockShowModal).toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    mockShowModal.mockRejectedValue(new Error('Modal error'));

    await handleCreatePersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to open create dialog'),
      flags: MessageFlags.Ephemeral,
    });
  });
});

describe('handleCreateModalSubmit', () => {
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

  it('should create new persona for existing user', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'existing-persona',
    });
    mockPrismaClient.persona.create.mockResolvedValue({ id: 'new-persona-123' });

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Work Persona',
        description: 'For work stuff',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'I am professional',
      })
    );

    expect(mockPrismaClient.persona.create).toHaveBeenCalledWith({
      data: {
        name: 'Work Persona',
        description: 'For work stuff',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'I am professional',
        ownerId: 'user-uuid',
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile "Work Persona" created'),
      flags: MessageFlags.Ephemeral,
    });
    // Should NOT set as default since user already has one
    expect(mockPrismaClient.user.update).not.toHaveBeenCalled();
  });

  it('should set as default if user has no default persona', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: null,
    });
    mockPrismaClient.persona.create.mockResolvedValue({ id: 'new-persona-123' });
    mockPrismaClient.user.update.mockResolvedValue({});

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'First Persona',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      })
    );

    expect(mockPrismaClient.user.update).toHaveBeenCalledWith({
      where: { id: 'user-uuid' },
      data: { defaultPersonaId: 'new-persona-123' },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('set as your default'),
      flags: MessageFlags.Ephemeral,
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

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'My Persona',
        description: '',
        preferredName: '',
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

  it('should require profile name', async () => {
    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: '',
        description: '',
        preferredName: 'Alice',
        pronouns: '',
        content: '',
      })
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile name is required'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockPrismaClient.persona.create).not.toHaveBeenCalled();
  });

  it('should handle empty optional fields', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'existing',
    });
    mockPrismaClient.persona.create.mockResolvedValue({ id: 'new-persona' });

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Minimal Persona',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      })
    );

    expect(mockPrismaClient.persona.create).toHaveBeenCalledWith({
      data: {
        name: 'Minimal Persona',
        description: null,
        preferredName: null,
        pronouns: null,
        content: '',
        ownerId: 'user-uuid',
      },
    });
  });

  it('should trim whitespace from fields', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      defaultPersonaId: 'existing',
    });
    mockPrismaClient.persona.create.mockResolvedValue({ id: 'new-persona' });

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: '  Work Persona  ',
        description: '  For work  ',
        preferredName: '  Alice  ',
        pronouns: '  she/her  ',
        content: '  content  ',
      })
    );

    expect(mockPrismaClient.persona.create).toHaveBeenCalledWith({
      data: {
        name: 'Work Persona',
        description: 'For work',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'content',
        ownerId: 'user-uuid',
      },
    });
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('DB error'));

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Test',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      })
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to create profile'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
