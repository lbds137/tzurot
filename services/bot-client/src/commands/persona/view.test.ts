/**
 * Tests for Persona View Handler
 * Tests gateway API calls and response rendering.
 *
 * Note: deferReply is handled by top-level interactionCreate handler,
 * so this handler uses editReply (not reply).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import { handleViewPersona, handleExpandContent } from './view.js';
import { mockListPersonasResponse, mockGetPersonaResponse } from '@tzurot/test-factories';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
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
  listPersonas: ReturnType<typeof vi.fn>;
  getPersona: ReturnType<typeof vi.fn>;
}

function makeStub(): PersonaClientStub {
  return {
    listPersonas: vi.fn(),
    getPersona: vi.fn(),
  };
}

describe('handleViewPersona', () => {
  const mockEditReply = vi.fn();
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContext() {
    return {
      user: { id: '123456789' },
      interaction: { user: { id: '123456789' } },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleViewPersona>[0];
  }

  it('should show error when user has no personas', async () => {
    stub.listPersonas.mockResolvedValue(makeOk(mockListPersonasResponse([])));

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona not found. Use `/persona edit` to create one!'),
    });
  });

  it('should show error when no default persona is set', async () => {
    stub.listPersonas.mockResolvedValue(
      makeOk(
        mockListPersonasResponse([
          { name: 'Test', isDefault: false },
          { name: 'Other', isDefault: false },
        ])
      )
    );

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Default persona not found'),
    });
  });

  it('should display persona with all fields', async () => {
    stub.listPersonas.mockResolvedValue(
      makeOk(mockListPersonasResponse([{ name: 'Test Profile', isDefault: true }]))
    );
    stub.getPersona.mockResolvedValue(
      makeOk(
        mockGetPersonaResponse({
          persona: {
            name: 'Test Profile',
            preferredName: 'TestUser',
            pronouns: 'they/them',
            content: 'I am a test user who loves programming',
            description: 'Test description',
          },
        })
      )
    );

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🎭 Your Persona',
          }),
        }),
      ],
      components: [], // No expand button for short content
    });
  });

  it('should handle gateway API errors gracefully', async () => {
    stub.listPersonas.mockResolvedValue(makeErr(500, 'Gateway error'));

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("Couldn't load your persona"),
    });
  });

  it('should handle network errors gracefully', async () => {
    stub.listPersonas.mockRejectedValue(new Error('Network error'));

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("Couldn't load your persona"),
    });
  });

  it('should show expand button for long content', async () => {
    const longContent = 'A'.repeat(1500); // Longer than CONTENT_PREVIEW_LENGTH
    stub.listPersonas.mockResolvedValue(
      makeOk(mockListPersonasResponse([{ name: 'Test Profile', isDefault: true }]))
    );
    stub.getPersona.mockResolvedValue(
      makeOk(
        mockGetPersonaResponse({
          persona: {
            name: 'Test Profile',
            preferredName: null,
            pronouns: null,
            content: longContent,
            description: null,
          },
        })
      )
    );

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalled();
    const call = mockEditReply.mock.calls[0][0];
    // Should have components (expand button)
    expect(call.components).toHaveLength(1);
  });

  it('should handle error when fetching details fails', async () => {
    stub.listPersonas.mockResolvedValue(
      makeOk(mockListPersonasResponse([{ name: 'Test Profile', isDefault: true }]))
    );
    stub.getPersona.mockResolvedValue(makeErr(500, 'Failed to fetch details'));

    await handleViewPersona(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("Couldn't load your persona"),
    });
  });
});

describe('handleExpandContent', () => {
  const mockDeferReply = vi.fn();
  const mockEditReply = vi.fn();
  const mockFollowUp = vi.fn();
  let stub: PersonaClientStub;

  const TEST_PERSONA_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    mockDeferReply.mockResolvedValue(undefined);
  });

  function createMockButtonInteraction() {
    return {
      user: { id: '123456789' },
      deferReply: mockDeferReply,
      editReply: mockEditReply,
      followUp: mockFollowUp,
      deferred: true,
      replied: false,
    } as unknown as Parameters<typeof handleExpandContent>[0];
  }

  it('should show full content when short', async () => {
    stub.getPersona.mockResolvedValue(
      makeOk(
        mockGetPersonaResponse({
          persona: {
            id: TEST_PERSONA_ID,
            name: 'Test',
            content: 'Short content',
          },
        })
      )
    );

    await handleExpandContent(createMockButtonInteraction(), TEST_PERSONA_ID, 'content');

    expect(mockDeferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mockEditReply).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('Short content') })
    );
    expect(mockFollowUp).not.toHaveBeenCalled();
  });

  it('should show not set message when content is empty', async () => {
    stub.getPersona.mockResolvedValue(
      makeOk(
        mockGetPersonaResponse({
          persona: {
            id: TEST_PERSONA_ID,
            name: 'Test',
            content: '',
          },
        })
      )
    );

    await handleExpandContent(createMockButtonInteraction(), TEST_PERSONA_ID, 'content');

    expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Not set'));
  });

  it('should show not set message when content is null', async () => {
    stub.getPersona.mockResolvedValue(
      makeOk({
        persona: {
          id: TEST_PERSONA_ID,
          name: 'Test',
          content: null,
          preferredName: null,
          pronouns: null,
          description: null,
          isDefault: false,
        },
      })
    );

    await handleExpandContent(createMockButtonInteraction(), TEST_PERSONA_ID, 'content');

    expect(mockEditReply).toHaveBeenCalledWith(expect.stringContaining('Not set'));
  });

  it('should split very long content into multiple messages', async () => {
    // Create content longer than Discord's message limit
    const veryLongContent = 'A'.repeat(3000);
    stub.getPersona.mockResolvedValue(
      makeOk(
        mockGetPersonaResponse({
          persona: {
            id: TEST_PERSONA_ID,
            name: 'Test',
            content: veryLongContent,
          },
        })
      )
    );

    await handleExpandContent(createMockButtonInteraction(), TEST_PERSONA_ID, 'content');

    expect(mockEditReply).toHaveBeenCalled();
    expect(mockFollowUp).toHaveBeenCalled();
  });

  it('should handle error when persona not found', async () => {
    stub.getPersona.mockResolvedValue(makeErr(404, 'Persona not found'));

    await handleExpandContent(createMockButtonInteraction(), TEST_PERSONA_ID, 'content');

    expect(mockEditReply).toHaveBeenCalledWith({ content: expect.stringContaining('not found') });
  });

  it('should handle network errors gracefully', async () => {
    stub.getPersona.mockRejectedValue(new Error('Network error'));

    await handleExpandContent(createMockButtonInteraction(), TEST_PERSONA_ID, 'content');

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to load the persona content'),
    });
  });
});
