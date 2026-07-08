/**
 * Tests for Override Clear Handler
 * Tests gateway API calls for clearing per-character persona overrides.
 *
 * Uses validated mock factories from @tzurot/common-types to ensure
 * test mocks match actual gateway API responses.
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleOverrideClear } from './clear.js';
import { mockClearOverrideResponse } from '@tzurot/test-factories';
import { makeOk, makeErr, asUserClient } from '../../../test/gatewayClientStubs.js';

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../../utils/gatewayClients.js', () => ({
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
  clearPersonaOverride: ReturnType<typeof vi.fn>;
}

function makeStub(): PersonaClientStub {
  return {
    clearPersonaOverride: vi.fn(),
  };
}

describe('handleOverrideClear', () => {
  const mockEditReply = vi.fn();
  let stub: PersonaClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = makeStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  function createMockContext(personalitySlug: string) {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
        user: { id: '123456789', username: 'testuser' },
        options: {
          getString: (name: string) => {
            if (name === 'character') return personalitySlug;
            return null;
          },
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleOverrideClear>[0];
  }

  it('should clear override successfully', async () => {
    stub.clearPersonaOverride.mockResolvedValue(
      makeOk(
        mockClearOverrideResponse({
          personality: { name: 'Lilith', displayName: 'Lilith' },
          hadOverride: true,
        })
      )
    );

    await handleOverrideClear(createMockContext('lilith'));

    expect(stub.clearPersonaOverride).toHaveBeenCalledWith('lilith');
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona override cleared'),
    });
  });

  it('should inform user if no override exists', async () => {
    stub.clearPersonaOverride.mockResolvedValue(
      makeOk(
        mockClearOverrideResponse({
          personality: { name: 'Lilith', displayName: 'Lilith' },
          hadOverride: false,
        })
      )
    );

    await handleOverrideClear(createMockContext('lilith'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have a persona override"),
    });
  });

  it('should error if personality not found', async () => {
    stub.clearPersonaOverride.mockResolvedValue(makeErr(404, 'Personality not found'));

    await handleOverrideClear(createMockContext('nonexistent'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Character "nonexistent" not found'),
    });
  });

  it('should error if user not found', async () => {
    stub.clearPersonaOverride.mockResolvedValue(makeErr(404, 'User has no account yet'));

    await handleOverrideClear(createMockContext('lilith'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an account yet"),
    });
  });

  it('should handle gateway errors gracefully', async () => {
    stub.clearPersonaOverride.mockRejectedValue(new Error('Network error'));

    await handleOverrideClear(createMockContext('lilith'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to clear the persona override'),
    });
  });

  it('rejects the autocomplete-error sentinel before calling the gateway', async () => {
    await handleOverrideClear(createMockContext('__autocomplete_error__'));

    expect(stub.clearPersonaOverride).not.toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
    });
  });
});
