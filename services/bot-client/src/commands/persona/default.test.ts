/**
 * Tests for Persona Default Handler
 * Tests gateway API calls for setting default persona.
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetDefaultPersona } from './default.js';
import { mockSetDefaultPersonaResponse } from '@tzurot/common-types';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
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

describe('handleSetDefaultPersona', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(personaId: string) {
    return {
      user: { id: '123456789', username: 'testuser' },
      interaction: {
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
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockSetDefaultPersonaResponse({
        persona: {
          name: 'Work Persona',
          preferredName: 'Alice',
        },
        alreadyDefault: false,
      }),
    });

    await handleSetDefaultPersona(createMockContext('persona-123'));

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/persona-123/default', {
      userId: '123456789',
      method: 'PATCH',
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Alice'),
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('now your default'),
    });
  });

  it('should use persona name if no preferredName', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockSetDefaultPersonaResponse({
        persona: {
          name: 'Work Persona',
          preferredName: null,
        },
        alreadyDefault: false,
      }),
    });

    await handleSetDefaultPersona(createMockContext('persona-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Work Persona'),
    });
  });

  it('should error if persona not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Persona not found',
    });

    await handleSetDefaultPersona(createMockContext('nonexistent-persona'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Persona not found'),
    });
  });

  it('should inform user if persona is already default', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockSetDefaultPersonaResponse({
        persona: {
          name: 'My Persona',
          preferredName: 'Alice',
        },
        alreadyDefault: true,
      }),
    });

    await handleSetDefaultPersona(createMockContext('persona-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already your default'),
    });
  });

  it('should handle gateway API errors gracefully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Gateway error',
    });

    await handleSetDefaultPersona(createMockContext('persona-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to set default'),
    });
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleSetDefaultPersona(createMockContext('persona-123'));

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to set default'),
    });
  });
});
