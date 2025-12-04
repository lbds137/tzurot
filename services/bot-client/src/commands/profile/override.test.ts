/**
 * Tests for Profile Override Handlers
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  handleOverrideSet,
  handleOverrideCreateModalSubmit,
  handleOverrideClear,
} from './override.js';
import { MessageFlags } from 'discord.js';
import { CREATE_NEW_PERSONA_VALUE } from './autocomplete.js';

// Mock Prisma
const mockPrismaClient = {
  user: {
    findUnique: vi.fn(),
  },
  personality: {
    findUnique: vi.fn(),
  },
  persona: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
  userPersonalityConfig: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
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

describe('handleOverrideSet', () => {
  const mockReply = vi.fn();
  const mockShowModal = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockShowModal.mockResolvedValue(undefined);
  });

  function createMockInteraction(personalitySlug: string, personaId: string) {
    return {
      user: { id: '123456789', username: 'testuser' },
      options: {
        getString: (name: string) => {
          if (name === 'personality') return personalitySlug;
          if (name === 'profile') return personaId;
          return null;
        },
      },
      reply: mockReply,
      showModal: mockShowModal,
    } as any;
  }

  it('should set existing persona as override', async () => {
    mockPrismaClient.personality.findUnique.mockResolvedValue({
      id: 'personality-uuid',
      name: 'Lilith',
      displayName: 'Lilith',
    });
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue({
      id: 'persona-123',
      name: 'Work Persona',
      preferredName: 'Alice',
    });
    mockPrismaClient.userPersonalityConfig.findUnique.mockResolvedValue(null);
    mockPrismaClient.userPersonalityConfig.create.mockResolvedValue({});

    await handleOverrideSet(createMockInteraction('lilith', 'persona-123'));

    expect(mockPrismaClient.userPersonalityConfig.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-uuid',
        personalityId: 'personality-uuid',
        personaId: 'persona-123',
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile override set'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show create modal when CREATE_NEW_PERSONA_VALUE selected', async () => {
    mockPrismaClient.personality.findUnique.mockResolvedValue({
      id: 'personality-uuid',
      name: 'Lilith',
      displayName: 'Lilith',
    });
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
    });

    await handleOverrideSet(createMockInteraction('lilith', CREATE_NEW_PERSONA_VALUE));

    expect(mockShowModal).toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('should update existing config when user has config', async () => {
    mockPrismaClient.personality.findUnique.mockResolvedValue({
      id: 'personality-uuid',
      name: 'Lilith',
      displayName: null,
    });
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue({
      id: 'persona-123',
      name: 'Work Persona',
      preferredName: null,
    });
    mockPrismaClient.userPersonalityConfig.findUnique.mockResolvedValue({
      id: 'config-uuid',
    });
    mockPrismaClient.userPersonalityConfig.update.mockResolvedValue({});

    await handleOverrideSet(createMockInteraction('lilith', 'persona-123'));

    expect(mockPrismaClient.userPersonalityConfig.update).toHaveBeenCalledWith({
      where: { id: 'config-uuid' },
      data: { personaId: 'persona-123' },
    });
  });

  it('should error if personality not found', async () => {
    mockPrismaClient.personality.findUnique.mockResolvedValue(null);

    await handleOverrideSet(createMockInteraction('nonexistent', 'persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Personality "nonexistent" not found'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should error if user not found', async () => {
    mockPrismaClient.personality.findUnique.mockResolvedValue({
      id: 'personality-uuid',
      name: 'Lilith',
      displayName: 'Lilith',
    });
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    await handleOverrideSet(createMockInteraction('lilith', 'persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account yet"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should error if profile not owned by user', async () => {
    mockPrismaClient.personality.findUnique.mockResolvedValue({
      id: 'personality-uuid',
      name: 'Lilith',
      displayName: 'Lilith',
    });
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
    });
    mockPrismaClient.persona.findFirst.mockResolvedValue(null);

    await handleOverrideSet(createMockInteraction('lilith', 'other-persona'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile not found'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.personality.findUnique.mockRejectedValue(new Error('DB error'));

    await handleOverrideSet(createMockInteraction('lilith', 'persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to set profile override'),
      flags: MessageFlags.Ephemeral,
    });
  });
});

describe('handleOverrideCreateModalSubmit', () => {
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

  it('should create new persona and set as override', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
    });
    mockPrismaClient.personality.findUnique.mockResolvedValue({
      name: 'Lilith',
      displayName: 'Lilith',
    });
    mockPrismaClient.persona.create.mockResolvedValue({ id: 'new-persona-123' });
    mockPrismaClient.userPersonalityConfig.findUnique.mockResolvedValue(null);
    mockPrismaClient.userPersonalityConfig.create.mockResolvedValue({});

    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Lilith Persona',
        description: 'For Lilith only',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'Special content for Lilith',
      }),
      'personality-uuid'
    );

    expect(mockPrismaClient.persona.create).toHaveBeenCalledWith({
      data: {
        name: 'Lilith Persona',
        description: 'For Lilith only',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'Special content for Lilith',
        ownerId: 'user-uuid',
      },
    });
    expect(mockPrismaClient.userPersonalityConfig.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-uuid',
        personalityId: 'personality-uuid',
        personaId: 'new-persona-123',
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile "Lilith Persona" created'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should require profile name', async () => {
    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: '',
        preferredName: '',
        pronouns: '',
        content: '',
      }),
      'personality-uuid'
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile name is required'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockPrismaClient.persona.create).not.toHaveBeenCalled();
  });

  it('should error if user not found', async () => {
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Test',
        preferredName: '',
        pronouns: '',
        content: '',
      }),
      'personality-uuid'
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('User not found'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.user.findUnique.mockRejectedValue(new Error('DB error'));

    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Test',
        preferredName: '',
        pronouns: '',
        content: '',
      }),
      'personality-uuid'
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to create profile'),
      flags: MessageFlags.Ephemeral,
    });
  });
});

describe('handleOverrideClear', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(personalitySlug: string) {
    return {
      user: { id: '123456789', username: 'testuser' },
      options: {
        getString: (name: string) => {
          if (name === 'personality') return personalitySlug;
          return null;
        },
      },
      reply: mockReply,
    } as any;
  }

  it('should clear override by deleting config', async () => {
    mockPrismaClient.personality.findUnique.mockResolvedValue({
      id: 'personality-uuid',
      name: 'Lilith',
      displayName: 'Lilith',
    });
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      personalityConfigs: [
        {
          id: 'config-uuid',
          personaId: 'persona-123',
          llmConfigId: null,
        },
      ],
    });
    mockPrismaClient.userPersonalityConfig.delete.mockResolvedValue({});

    await handleOverrideClear(createMockInteraction('lilith'));

    expect(mockPrismaClient.userPersonalityConfig.delete).toHaveBeenCalledWith({
      where: { id: 'config-uuid' },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile override cleared'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should clear override by updating config if llmConfigId exists', async () => {
    mockPrismaClient.personality.findUnique.mockResolvedValue({
      id: 'personality-uuid',
      name: 'Lilith',
      displayName: null,
    });
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      personalityConfigs: [
        {
          id: 'config-uuid',
          personaId: 'persona-123',
          llmConfigId: 'llm-config-uuid',
        },
      ],
    });
    mockPrismaClient.userPersonalityConfig.update.mockResolvedValue({});

    await handleOverrideClear(createMockInteraction('lilith'));

    expect(mockPrismaClient.userPersonalityConfig.update).toHaveBeenCalledWith({
      where: { id: 'config-uuid' },
      data: { personaId: null },
    });
    expect(mockPrismaClient.userPersonalityConfig.delete).not.toHaveBeenCalled();
  });

  it('should inform user if no override exists', async () => {
    mockPrismaClient.personality.findUnique.mockResolvedValue({
      id: 'personality-uuid',
      name: 'Lilith',
      displayName: 'Lilith',
    });
    mockPrismaClient.user.findUnique.mockResolvedValue({
      id: 'user-uuid',
      personalityConfigs: [
        {
          id: 'config-uuid',
          personaId: null,
          llmConfigId: null,
        },
      ],
    });

    await handleOverrideClear(createMockInteraction('lilith'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have a profile override"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should error if personality not found', async () => {
    mockPrismaClient.personality.findUnique.mockResolvedValue(null);

    await handleOverrideClear(createMockInteraction('nonexistent'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Personality "nonexistent" not found'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should error if user not found', async () => {
    mockPrismaClient.personality.findUnique.mockResolvedValue({
      id: 'personality-uuid',
      name: 'Lilith',
      displayName: 'Lilith',
    });
    mockPrismaClient.user.findUnique.mockResolvedValue(null);

    await handleOverrideClear(createMockInteraction('lilith'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account yet"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle database errors gracefully', async () => {
    mockPrismaClient.personality.findUnique.mockRejectedValue(new Error('DB error'));

    await handleOverrideClear(createMockInteraction('lilith'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to clear profile override'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
