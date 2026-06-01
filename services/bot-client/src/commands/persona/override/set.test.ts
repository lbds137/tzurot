/**
 * Tests for Override Set Handler
 * Tests typed-client calls for setting per-character persona overrides.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOverrideSet, handleOverrideCreateModalSubmit } from './set.js';
import { MessageFlags } from 'discord.js';
import { CREATE_NEW_PERSONA_VALUE } from '../autocomplete.js';
import {
  mockSetOverrideResponse,
  mockOverrideInfoResponse,
  mockCreateOverrideResponse,
  API_ERROR_SUBCODE,
} from '@tzurot/common-types';
import { makeOk, makeErr, asUserClient } from '../../../test/gatewayClientStubs.js';

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/gatewayClients.js', () => ({
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
    truncateText: (text: string, maxLength: number, ellipsis = '…') => {
      if (!text) return '';
      if (text.length <= maxLength) return text;
      return text.slice(0, maxLength - ellipsis.length) + ellipsis;
    },
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
        options: {
          getString: (name: string) => {
            if (name === 'character') return personalitySlug;
            if (name === 'persona') return personaId;
            return null;
          },
        },
      },
      reply: mockReply,
      showModal: mockShowModal,
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
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona override set'),
      flags: MessageFlags.Ephemeral,
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

  it('should error if personality not found', async () => {
    stub.setPersonaOverride.mockResolvedValue(makeErr(404, 'Personality not found'));

    await handleOverrideSet(createMockContext('nonexistent', 'persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Personality "nonexistent" not found'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should error if user not found', async () => {
    stub.setPersonaOverride.mockResolvedValue(makeErr(404, 'User has no account yet'));

    await handleOverrideSet(createMockContext('lilith', 'persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account yet"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should error if persona not owned by user', async () => {
    stub.setPersonaOverride.mockResolvedValue(makeErr(404, 'Persona not found'));

    await handleOverrideSet(createMockContext('lilith', 'other-persona'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona not found'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle gateway errors gracefully', async () => {
    stub.setPersonaOverride.mockRejectedValue(new Error('Network error'));

    await handleOverrideSet(createMockContext('lilith', 'persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to set persona override'),
      flags: MessageFlags.Ephemeral,
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
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona "Lilith Persona" created'),
      flags: MessageFlags.Ephemeral,
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

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona name is required'),
      flags: MessageFlags.Ephemeral,
    });
    expect(stub.createPersonaOverride).not.toHaveBeenCalled();
  });

  it('should error if user not found', async () => {
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

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('User not found'),
      flags: MessageFlags.Ephemeral,
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

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already have a persona named "Dup"'),
      flags: MessageFlags.Ephemeral,
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

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to create persona'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
