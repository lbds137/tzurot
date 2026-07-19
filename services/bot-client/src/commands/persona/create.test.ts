/**
 * Tests for Persona Create Handler
 * Tests modal display and gateway API calls for persona creation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCreatePersona, handleCreateModalSubmit } from './create.js';
import { MessageFlags } from 'discord.js';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import { mockCreatePersonaResponse } from '@tzurot/test-factories';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

// The retry affordance stashes submitted values in a dashboard session
const sessionSetMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/dashboard/index.js', () => ({
  getSessionManager: () => ({ set: sessionSetMock }),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
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
      content: expect.stringContaining('Failed to open the create dialog'),
      flags: MessageFlags.Ephemeral,
    });
  });
});

describe('handleCreateModalSubmit', () => {
  const mockReply = vi.fn();
  const mockDeferReply = vi.fn();
  const mockEditReply = vi.fn();
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    // Failure paths stash retry values against the error reply's message id
    mockEditReply.mockResolvedValue({ id: 'message-123' });
  });

  function createMockModalInteraction(fields: Record<string, string>) {
    return {
      user: { id: '123456789', username: 'testuser' },
      channelId: 'channel-123',
      fields: {
        getTextInputValue: (name: string) => fields[name] ?? '',
      },
      reply: mockReply,
      deferReply: mockDeferReply,
      editReply: mockEditReply,
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
    // Ack-first: deferReply runs before the createPersona gateway call; the
    // result lands via editReply, never a bare reply.
    expect(mockDeferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mockReply).not.toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona "Work Persona" created'),
    });
  });

  it('should surface a name-collision message instead of a generic error', async () => {
    stub.createPersona.mockResolvedValue(
      makeErr(400, 'You already have a persona named "Dup".', API_ERROR_SUBCODE.NAME_COLLISION)
    );

    await handleCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Dup',
        content: 'whatever',
      })
    );

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('already have a persona named "Dup"'),
        components: expect.any(Array),
      })
    );

    // Seam: the submitted values must reach the retry stash so the
    // Try-again button can reopen the modal prefilled.
    expect(sessionSetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        entityType: 'modal-retry',
        messageId: 'message-123',
        data: {
          kind: 'create',
          values: expect.objectContaining({ personaName: 'Dup', content: 'whatever' }),
        },
      })
    );
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

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Persona name is required'),
        components: expect.any(Array),
      })
    );
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

    // Transient gateway failures carry the retry affordance too
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Gateway error'),
        components: expect.any(Array),
      })
    );
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

    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('Failed to create the persona'),
        components: expect.any(Array),
      })
    );
  });
});
