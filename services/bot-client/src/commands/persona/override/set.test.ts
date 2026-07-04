/**
 * Tests for Override Set Handler
 * Tests typed-client calls for setting per-character persona overrides.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOverrideSet, handleOverrideCreateModalSubmit } from './set.js';
import { MessageFlags } from 'discord.js';
import { CREATE_NEW_PERSONA_VALUE } from '../autocomplete.js';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import {
  mockSetOverrideResponse,
  mockOverrideInfoResponse,
  mockCreateOverrideResponse,
} from '@tzurot/test-factories';
import { makeOk, makeErr, asUserClient } from '../../../test/gatewayClientStubs.js';

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

vi.mock('@tzurot/common-types/utils/discord', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/discord')>(
    '@tzurot/common-types/utils/discord'
  );
  return {
    ...actual,
    truncateText: (text: string, maxLength: number, ellipsis = '…') => {
      if (!text) return '';
      if (text.length <= maxLength) return text;
      return text.slice(0, maxLength - ellipsis.length) + ellipsis;
    },
  };
});

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
  setPersonaOverride: ReturnType<typeof vi.fn>;
  getPersonaOverride: ReturnType<typeof vi.fn>;
  createPersonaOverride: ReturnType<typeof vi.fn>;
}

function makeStub(): PersonaClientStub {
  return {
    setPersonaOverride: vi.fn(),
    getPersonaOverride: vi.fn(),
    createPersonaOverride: vi.fn(),
  };
}

describe('handleOverrideSet', () => {
  const mockReply = vi.fn();
  const mockDeferReply = vi.fn();
  const mockEditReply = vi.fn();
  const mockShowModal = vi.fn();
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    mockShowModal.mockResolvedValue(undefined);
  });

  function createMockContext(personalitySlug: string, personaId: string) {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
        user: { id: '123456789', username: 'testuser' },
        // showModal is wrapped via showModalWithTimeoutCatch(context.interaction),
        // so the mock lives on the raw interaction, not the context passthrough.
        showModal: mockShowModal,
        followUp: vi.fn(),
        // editReply lives on the raw interaction — ModalCommandContext exposes
        // deferReply but not editReply, so setExistingOverride edits via
        // context.interaction.editReply.
        editReply: mockEditReply,
        // The catch branches on ack state; deferred reflects whether the
        // setExisting path called deferReply.
        get deferred() {
          return mockDeferReply.mock.calls.length > 0;
        },
        replied: false,
        options: {
          getString: (name: string) => {
            if (name === 'character') return personalitySlug;
            if (name === 'persona') return personaId;
            return null;
          },
        },
      },
      reply: mockReply,
      deferReply: mockDeferReply,
    } as unknown as Parameters<typeof handleOverrideSet>[0];
  }

  it('should set existing persona as override', async () => {
    stub.setPersonaOverride.mockResolvedValue(
      makeOk(
        mockSetOverrideResponse({
          personality: { name: 'Lilith', displayName: 'Lilith' },
          persona: { name: 'Work Persona', preferredName: 'Alice' },
        })
      )
    );

    await handleOverrideSet(createMockContext('lilith', 'persona-123'));

    expect(stub.setPersonaOverride).toHaveBeenCalledWith('lilith', { personaId: 'persona-123' });
    // Ack-first: deferReply before the gateway write; result lands via editReply.
    expect(mockDeferReply).toHaveBeenCalledWith({ ephemeral: true });
    expect(mockReply).not.toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona override set'),
    });
  });

  it('should show create modal when CREATE_NEW_PERSONA_VALUE selected', async () => {
    stub.getPersonaOverride.mockResolvedValue(
      makeOk(
        mockOverrideInfoResponse({
          personality: { name: 'Lilith', displayName: 'Lilith' },
        })
      )
    );

    await handleOverrideSet(createMockContext('lilith', CREATE_NEW_PERSONA_VALUE));

    expect(stub.getPersonaOverride).toHaveBeenCalledWith('lilith');
    expect(mockShowModal).toHaveBeenCalled();
    expect(mockReply).not.toHaveBeenCalled();
  });

  it('replies (not showModal) when the create-modal prep lookup fails', async () => {
    // showCreateOverrideModal's !infoResult.ok branch: getPersonaOverride errors
    // before the modal is built, so it replies with the mapped error and never
    // shows a modal.
    stub.getPersonaOverride.mockResolvedValue(makeErr(404, 'Personality not found'));

    await handleOverrideSet(createMockContext('lilith', CREATE_NEW_PERSONA_VALUE));

    expect(mockShowModal).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Character "lilith" not found'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('falls back to reply in the catch when the modal branch throws un-acked', async () => {
    // getPersonaOverride rejecting makes showCreateOverrideModal throw before any
    // ack, so handleOverrideSet's catch runs on a NOT-deferred interaction → reply
    // (not editReply). Exercises the catch's else branch.
    stub.getPersonaOverride.mockRejectedValue(new Error('Network error'));

    await handleOverrideSet(createMockContext('lilith', CREATE_NEW_PERSONA_VALUE));

    expect(mockDeferReply).not.toHaveBeenCalled();
    expect(mockEditReply).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to set persona override'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('surfaces the generic failure message when the gateway error is unmapped', async () => {
    // setExistingOverride's !result.ok + mapOverrideError-returns-null branch: an
    // unrecognized gateway error falls through to the generic editReply.
    stub.setPersonaOverride.mockResolvedValue(makeErr(500, 'Internal server error'));

    await handleOverrideSet(createMockContext('lilith', 'persona-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to set persona override'),
    });
  });

  it('should error if personality not found', async () => {
    stub.setPersonaOverride.mockResolvedValue(makeErr(404, 'Personality not found'));

    await handleOverrideSet(createMockContext('nonexistent', 'persona-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Character "nonexistent" not found'),
    });
  });

  it('should error if user not found', async () => {
    stub.setPersonaOverride.mockResolvedValue(makeErr(404, 'User has no account yet'));

    await handleOverrideSet(createMockContext('lilith', 'persona-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account yet"),
    });
  });

  it('should error if persona not owned by user', async () => {
    stub.setPersonaOverride.mockResolvedValue(makeErr(404, 'Persona not found'));

    await handleOverrideSet(createMockContext('lilith', 'other-persona'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona not found'),
    });
  });

  it('should handle gateway errors gracefully', async () => {
    stub.setPersonaOverride.mockRejectedValue(new Error('Network error'));

    await handleOverrideSet(createMockContext('lilith', 'persona-123'));

    // setPersonaOverride threw after the deferReply, so the catch is post-defer → editReply.
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to set persona override'),
    });
  });

  it('rejects the autocomplete-error sentinel in the personality option before calling the gateway', async () => {
    await handleOverrideSet(createMockContext('__autocomplete_error__', 'persona-123'));

    expect(stub.setPersonaOverride).not.toHaveBeenCalled();
    expect(stub.getPersonaOverride).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('rejects the autocomplete-error sentinel in the persona option before calling the gateway', async () => {
    await handleOverrideSet(createMockContext('lilith', '__autocomplete_error__'));

    expect(stub.setPersonaOverride).not.toHaveBeenCalled();
    expect(stub.getPersonaOverride).not.toHaveBeenCalled();
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
      flags: MessageFlags.Ephemeral,
    });
  });
});

describe('handleOverrideCreateModalSubmit', () => {
  const mockReply = vi.fn();
  const mockDeferReply = vi.fn();
  const mockEditReply = vi.fn();
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
      deferReply: mockDeferReply,
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleOverrideCreateModalSubmit>[0];
  }

  it('should create new persona and set as override', async () => {
    stub.createPersonaOverride.mockResolvedValue(
      makeOk(
        mockCreateOverrideResponse({
          persona: {
            name: 'Lilith Persona',
            preferredName: 'Alice',
            description: 'For Lilith only',
            pronouns: 'she/her',
            content: 'Special content for Lilith',
          },
          personality: {
            name: 'Lilith',
            displayName: 'Lilith',
          },
        })
      )
    );

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

    expect(stub.createPersonaOverride).toHaveBeenCalledWith('personality-uuid', {
      name: 'Lilith Persona',
      description: 'For Lilith only',
      preferredName: 'Alice',
      pronouns: 'she/her',
      content: 'Special content for Lilith',
    });
    // Ack-first: deferReply runs before the createPersonaOverride gateway call;
    // the result lands via editReply, never a bare reply.
    expect(mockDeferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(mockReply).not.toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona "Lilith Persona" created'),
    });
  });

  it('should require persona name', async () => {
    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: '',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      }),
      'personality-uuid'
    );

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona name is required'),
    });
    expect(stub.createPersonaOverride).not.toHaveBeenCalled();
  });

  it('should surface the friendly no-account message when the user is not found', async () => {
    // Routed through mapOverrideError like the sibling handlers — the mapper's
    // "no account yet" phrasing replaces the old hardcoded "User not found".
    stub.createPersonaOverride.mockResolvedValue(makeErr(404, 'User not found'));

    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Test',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      }),
      'personality-uuid'
    );

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account yet"),
    });
  });

  it('should surface the specific character-not-found message for a stale personality', async () => {
    // The regression this closes: a stale/deleted personalityId used to degrade
    // to the generic "Failed to create persona" because the create-modal branch
    // skipped mapOverrideError while its siblings used it.
    stub.createPersonaOverride.mockResolvedValue(makeErr(404, 'Personality not found'));

    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Test',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      }),
      'personality-uuid'
    );

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Character "personality-uuid" not found'),
    });
  });

  it('should surface a name-collision message instead of a generic error', async () => {
    stub.createPersonaOverride.mockResolvedValue(
      makeErr(400, 'You already have a persona named "Dup".', API_ERROR_SUBCODE.NAME_COLLISION)
    );

    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Dup',
        description: '',
        preferredName: '',
        pronouns: '',
        content: 'whatever',
      }),
      'personality-uuid'
    );

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already have a persona named "Dup"'),
    });
  });

  it('should handle gateway errors gracefully', async () => {
    stub.createPersonaOverride.mockRejectedValue(new Error('Network error'));

    await handleOverrideCreateModalSubmit(
      createMockModalInteraction({
        personaName: 'Test',
        description: '',
        preferredName: '',
        pronouns: '',
        content: '',
      }),
      'personality-uuid'
    );

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to create persona'),
    });
  });
});
