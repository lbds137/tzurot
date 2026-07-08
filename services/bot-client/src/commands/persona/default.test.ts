/**
 * Tests for Persona Default Handler
 * Tests gateway API calls for setting default persona.
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetDefaultPersona } from './default.js';
import { mockSetDefaultPersonaResponse } from '@tzurot/test-factories';
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
  setPersonaDefault: ReturnType<typeof vi.fn>;
}

function makeStub(): PersonaClientStub {
  return {
    setPersonaDefault: vi.fn(),
  };
}

describe('handleSetDefaultPersona', () => {
  const mockEditReply = vi.fn();
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContext(personaId: string) {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
        user: { id: '123456789', username: 'testuser' },
        options: {
          getString: (name: string) => {
            if (name === 'persona') return personaId;
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleSetDefaultPersona>[0];
  }

  it('should set persona as default', async () => {
    stub.setPersonaDefault.mockResolvedValue(
      makeOk(
        mockSetDefaultPersonaResponse({
          persona: {
            name: 'Work Persona',
            preferredName: 'Alice',
          },
          alreadyDefault: false,
        })
      )
    );

    await handleSetDefaultPersona(createMockContext('persona-123'));

    expect(stub.setPersonaDefault).toHaveBeenCalledWith('persona-123');
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Alice'),
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('now your default'),
    });
  });

  it('should use persona name if no preferredName', async () => {
    stub.setPersonaDefault.mockResolvedValue(
      makeOk(
        mockSetDefaultPersonaResponse({
          persona: {
            name: 'Work Persona',
            preferredName: null,
          },
          alreadyDefault: false,
        })
      )
    );

    await handleSetDefaultPersona(createMockContext('persona-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Work Persona'),
    });
  });

  it('should error if persona not found', async () => {
    stub.setPersonaDefault.mockResolvedValue(makeErr(404, 'Persona not found'));

    await handleSetDefaultPersona(createMockContext('nonexistent-persona'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona not found'),
    });
  });

  it('should inform user if persona is already default', async () => {
    stub.setPersonaDefault.mockResolvedValue(
      makeOk(
        mockSetDefaultPersonaResponse({
          persona: {
            name: 'My Persona',
            preferredName: 'Alice',
          },
          alreadyDefault: true,
        })
      )
    );

    await handleSetDefaultPersona(createMockContext('persona-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already your default'),
    });
  });

  it('should handle gateway API errors gracefully', async () => {
    stub.setPersonaDefault.mockResolvedValue(makeErr(500, 'Gateway error'));

    await handleSetDefaultPersona(createMockContext('persona-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Gateway error'),
    });
  });

  it('should handle network errors gracefully', async () => {
    stub.setPersonaDefault.mockRejectedValue(new Error('Network error'));

    await handleSetDefaultPersona(createMockContext('persona-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to'),
    });
  });

  it('rejects the autocomplete-error sentinel before calling the gateway', async () => {
    await handleSetDefaultPersona(createMockContext('__autocomplete_error__'));

    expect(stub.setPersonaDefault).not.toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
    });
  });
});
