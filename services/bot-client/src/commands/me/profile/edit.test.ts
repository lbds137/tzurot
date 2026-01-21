/**
 * Tests for Profile Edit Handler
 * Tests modal display and gateway API calls for profile editing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleEditPersona, handleEditModalSubmit } from './edit.js';
import { MessageFlags } from 'discord.js';
import {
  mockListPersonasResponse,
  mockGetPersonaResponse,
  mockUpdatePersonaResponse,
  mockCreatePersonaResponse,
} from '@tzurot/common-types';

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

describe('handleEditPersona', () => {
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
    } as unknown as Parameters<typeof handleEditPersona>[0];
  }

  it('should show modal with empty fields for user with no persona', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([]),
    });

    await handleEditPersona(createMockContext());

    expect(mockShowModal).toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('should show modal with existing persona values when editing default', async () => {
    // First call returns persona list
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: mockListPersonasResponse([{ name: 'My Persona', isDefault: true }]),
    });
    // Second call returns persona details
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: mockGetPersonaResponse({
        persona: {
          name: 'My Persona',
          description: 'My main persona',
          preferredName: 'Alice',
          pronouns: 'she/her',
          content: 'I love coding',
        },
      }),
    });

    await handleEditPersona(createMockContext());

    expect(mockShowModal).toHaveBeenCalled();
  });

  it('should show modal for specific persona when personaId provided', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockGetPersonaResponse({
        persona: {
          name: 'Work Persona',
          preferredName: 'Bob',
          pronouns: 'he/him',
          content: 'Work stuff',
        },
      }),
    });

    await handleEditPersona(createMockContext(), 'specific-persona');

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/specific-persona', {
      userId: '123456789',
    });
    expect(mockShowModal).toHaveBeenCalled();
  });

  it('should show error when specific profile not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Persona not found',
    });

    await handleEditPersona(createMockContext(), 'nonexistent-persona');

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile not found'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockShowModal).not.toHaveBeenCalled();
  });

  it('should handle gateway errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleEditPersona(createMockContext());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to open edit dialog'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockShowModal).not.toHaveBeenCalled();
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
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockUpdatePersonaResponse({
        persona: {
          name: 'My Persona',
          description: 'Main persona',
          preferredName: 'Alice',
          pronouns: 'she/her',
          content: 'I love coding',
        },
      }),
    });

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

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/persona-123', {
      userId: '123456789',
      method: 'PUT',
      body: {
        name: 'My Persona',
        description: 'Main persona',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'I love coding',
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile updated'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should create new persona when personaId is "new"', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockCreatePersonaResponse({
        persona: {
          name: 'New Persona',
          description: 'Brand new',
          preferredName: 'Bob',
          pronouns: 'he/him',
          content: 'Test content',
        },
        setAsDefault: true,
      }),
    });

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

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona', {
      userId: '123456789',
      method: 'POST',
      body: {
        name: 'New Persona',
        description: 'Brand new',
        preferredName: 'Bob',
        pronouns: 'he/him',
        content: 'Test content',
        username: 'testuser',
      },
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('set as your default'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle empty optional fields', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockUpdatePersonaResponse({
        persona: {
          name: 'My Persona',
          description: null,
          preferredName: null,
          pronouns: null,
          content: '',
        },
      }),
    });

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

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/persona-123', {
      userId: '123456789',
      method: 'PUT',
      body: {
        name: 'My Persona',
        description: null,
        preferredName: null,
        pronouns: null,
        content: '',
      },
    });
  });

  it('should require profile name', async () => {
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
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should trim whitespace from fields', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockUpdatePersonaResponse({
        persona: {
          name: 'My Persona',
          description: 'Main persona',
          preferredName: 'Alice',
          pronouns: 'she/her',
          content: 'content with spaces',
        },
      }),
    });

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

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/persona-123', {
      userId: '123456789',
      method: 'PUT',
      body: {
        name: 'My Persona',
        description: 'Main persona',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'content with spaces',
      },
    });
  });

  it('should handle gateway errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

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
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Persona not found',
    });

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
  });
});
