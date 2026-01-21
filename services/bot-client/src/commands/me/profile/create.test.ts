/**
 * Tests for Profile Create Handler
 * Tests modal display and gateway API calls for profile creation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCreatePersona, handleCreateModalSubmit } from './create.js';
import { MessageFlags } from 'discord.js';
import { mockCreatePersonaResponse } from '@tzurot/common-types';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

describe('handleCreatePersona', () => {
  const mockShowModal = vi.fn();
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockShowModal.mockResolvedValue(undefined);
  });

  function createMockContext() {
    return {
      user: { id: '123456789', username: 'testuser' },
      showModal: mockShowModal,
      reply: mockReply,
    } as unknown as Parameters<typeof handleCreatePersona>[0];
  }

  it('should show create modal', async () => {
    await handleCreatePersona(createMockContext());

    expect(mockShowModal).toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('should handle errors gracefully', async () => {
    mockShowModal.mockRejectedValue(new Error('Modal error'));

    await handleCreatePersona(createMockContext());

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

  it('should create new persona via gateway', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockCreatePersonaResponse({
        persona: {
          name: 'Work Persona',
          description: 'For work stuff',
          preferredName: 'Alice',
          pronouns: 'she/her',
          content: 'I am professional',
        },
        setAsDefault: false,
      }),
    });

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Work Persona',
        description: 'For work stuff',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'I am professional',
      })
    );

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona', {
      userId: '123456789',
      method: 'POST',
      body: {
        name: 'Work Persona',
        description: 'For work stuff',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'I am professional',
        username: 'testuser',
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile "Work Persona" created'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should indicate when set as default', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockCreatePersonaResponse({
        persona: {
          name: 'First Persona',
          description: null,
          preferredName: null,
          pronouns: null,
          content: null,
        },
        setAsDefault: true,
      }),
    });

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'First Persona',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      })
    );

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('set as your default'),
      flags: MessageFlags.Ephemeral,
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
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should handle empty optional fields', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockCreatePersonaResponse({
        persona: {
          name: 'Minimal Persona',
          description: null,
          preferredName: null,
          pronouns: null,
          content: '',
        },
        setAsDefault: false,
      }),
    });

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Minimal Persona',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      })
    );

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona', {
      userId: '123456789',
      method: 'POST',
      body: {
        name: 'Minimal Persona',
        description: null,
        preferredName: null,
        pronouns: null,
        content: '',
        username: 'testuser',
      },
    });
  });

  it('should trim whitespace from fields', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockCreatePersonaResponse({
        persona: {
          name: 'Work Persona',
          description: 'For work',
          preferredName: 'Alice',
          pronouns: 'she/her',
          content: 'content',
        },
        setAsDefault: false,
      }),
    });

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: '  Work Persona  ',
        description: '  For work  ',
        preferredName: '  Alice  ',
        pronouns: '  she/her  ',
        content: '  content  ',
      })
    );

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona', {
      userId: '123456789',
      method: 'POST',
      body: {
        name: 'Work Persona',
        description: 'For work',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'content',
        username: 'testuser',
      },
    });
  });

  it('should handle gateway API errors gracefully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Gateway error',
    });

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

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

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
