/**
 * Tests for Override Set Handler
 * Tests gateway API calls for setting per-character persona overrides.
 *
 * Uses validated mock factories from @tzurot/common-types to ensure
 * test mocks match actual gateway API responses.
 *
 * NOTE: `handleOverrideCreateModalSubmit` still uses the legacy
 * `callGatewayApi` path because its endpoint
 * (`POST /user/persona/override/by-id/:personalityId`) is not yet in the
 * route manifest. That handler retains the old mock pattern below.
 * `handleOverrideSet` uses the typed `userClient` and is wired through
 * the `gatewayClientStubs` helpers.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOverrideSet, handleOverrideCreateModalSubmit } from './set.js';
import { MessageFlags } from 'discord.js';
import { CREATE_NEW_PERSONA_VALUE } from '../autocomplete.js';
import {
  mockSetOverrideResponse,
  mockOverrideInfoResponse,
  mockCreateOverrideResponse,
} from '@tzurot/common-types';
import { makeOk, makeErr, asUserClient } from '../../../test/gatewayClientStubs.js';

// Mock gateway client for the legacy callGatewayApi path
// (handleOverrideCreateModalSubmit only).
const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', async () => {
  const actual = await vi.importActual<typeof import('../../../utils/userGatewayClient.js')>(
    '../../../utils/userGatewayClient.js'
  );
  return {
    ...actual,
    callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  };
});

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
    // Ensure truncateText is available (in case of build cache issues)
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
}

function makeStub(): PersonaClientStub {
  return {
    setPersonaOverride: vi.fn(),
    getPersonaOverride: vi.fn(),
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

// handleOverrideCreateModalSubmit still uses the legacy callGatewayApi
// path because the `POST /user/persona/override/by-id/:personalityId`
// endpoint isn't in the route manifest yet. Once that endpoint is added,
// migrate this describe to the userClient pattern (createPersona +
// setPersonaOverride, or a dedicated method).
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
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockCreateOverrideResponse({
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
      }),
    });

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

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/persona/override/by-id/personality-uuid',
      {
        user: {
          discordId: '123456789',
          username: 'testuser',
          displayName: 'testuser',
        },
        method: 'POST',
        body: {
          name: 'Lilith Persona',
          description: 'For Lilith only',
          preferredName: 'Alice',
          pronouns: 'she/her',
          content: 'Special content for Lilith',
          username: 'testuser',
        },
      }
    );
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
    expect(mockCallGatewayApi).not.toHaveBeenCalled();
  });

  it('should error if user not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'User not found',
    });

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

  it('should handle gateway errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

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
