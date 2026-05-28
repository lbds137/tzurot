/**
 * Tests for Persona Create Handler
 * Tests modal display and gateway API calls for persona creation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCreatePersona, handleCreateModalSubmit } from './create.js';
import { MessageFlags } from 'discord.js';
import { mockCreatePersonaResponse } from '@tzurot/common-types';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
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

interface PersonaClientStub {
  createPersona: ReturnType<typeof vi.fn>;
}

function makeStub(): PersonaClientStub {
  return {
    createPersona: vi.fn(),
  };
}

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
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
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
    stub.createPersona.mockResolvedValue(
      makeOk(
        mockCreatePersonaResponse({
          persona: {
            name: 'Work Persona',
            description: 'For work stuff',
            preferredName: 'Alice',
            pronouns: 'she/her',
            content: 'I am professional',
          },
        })
      )
    );

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Work Persona',
        description: 'For work stuff',
        preferredName: 'Alice',
        pronouns: 'she/her',
        content: 'I am professional',
      })
    );

    expect(stub.createPersona).toHaveBeenCalledWith({
      name: 'Work Persona',
      description: 'For work stuff',
      preferredName: 'Alice',
      pronouns: 'she/her',
      content: 'I am professional',
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona "Work Persona" created'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should require persona name', async () => {
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
      content: expect.stringContaining('Persona name is required'),
      flags: MessageFlags.Ephemeral,
    });
    expect(stub.createPersona).not.toHaveBeenCalled();
  });

  it('should handle empty optional fields', async () => {
    stub.createPersona.mockResolvedValue(
      makeOk(
        mockCreatePersonaResponse({
          persona: {
            name: 'Minimal Persona',
            description: null,
            preferredName: null,
            pronouns: null,
            content: '',
          },
        })
      )
    );

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Minimal Persona',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      })
    );

    expect(stub.createPersona).toHaveBeenCalledWith({
      name: 'Minimal Persona',
      description: null,
      preferredName: null,
      pronouns: null,
      content: '',
    });
  });

  it('should trim whitespace from fields', async () => {
    stub.createPersona.mockResolvedValue(
      makeOk(
        mockCreatePersonaResponse({
          persona: {
            name: 'Work Persona',
            description: 'For work',
            preferredName: 'Alice',
            pronouns: 'she/her',
            content: 'content',
          },
        })
      )
    );

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: '  Work Persona  ',
        description: '  For work  ',
        preferredName: '  Alice  ',
        pronouns: '  she/her  ',
        content: '  content  ',
      })
    );

    expect(stub.createPersona).toHaveBeenCalledWith({
      name: 'Work Persona',
      description: 'For work',
      preferredName: 'Alice',
      pronouns: 'she/her',
      content: 'content',
    });
  });

  it('should handle gateway API errors gracefully', async () => {
    stub.createPersona.mockResolvedValue(makeErr(500, 'Gateway error'));

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
      content: expect.stringContaining('Failed to create persona'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle network errors gracefully', async () => {
    stub.createPersona.mockRejectedValue(new Error('Network error'));

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
      content: expect.stringContaining('Failed to create persona'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
