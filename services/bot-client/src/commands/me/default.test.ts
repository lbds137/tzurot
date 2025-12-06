/**
 * Tests for Profile Default Handler
 * Tests gateway API calls for setting default profile.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleSetDefaultPersona } from './default.js';
import { MessageFlags } from 'discord.js';

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
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(personaId: string) {
    return {
      user: { id: '123456789', username: 'testuser' },
      options: {
        getString: (name: string) => {
          if (name === 'profile') return personaId;
          return null;
        },
      },
      reply: mockReply,
    } as any;
  }

  it('should set persona as default', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        persona: {
          id: 'persona-123',
          name: 'Work Persona',
          preferredName: 'Alice',
        },
        alreadyDefault: false,
      },
    });

    await handleSetDefaultPersona(createMockInteraction('persona-123'));

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/persona/persona-123/default', {
      userId: '123456789',
      method: 'PATCH',
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Alice'),
      flags: MessageFlags.Ephemeral,
    });
    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('now your default'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should use persona name if no preferredName', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        persona: {
          id: 'persona-123',
          name: 'Work Persona',
          preferredName: null,
        },
        alreadyDefault: false,
      },
    });

    await handleSetDefaultPersona(createMockInteraction('persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Work Persona'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should error if profile not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Persona not found',
    });

    await handleSetDefaultPersona(createMockInteraction('nonexistent-persona'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Profile not found'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should inform user if persona is already default', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        success: true,
        persona: {
          id: 'persona-123',
          name: 'My Persona',
          preferredName: 'Alice',
        },
        alreadyDefault: true,
      },
    });

    await handleSetDefaultPersona(createMockInteraction('persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('already your default'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle gateway API errors gracefully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Gateway error',
    });

    await handleSetDefaultPersona(createMockInteraction('persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to set default'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleSetDefaultPersona(createMockInteraction('persona-123'));

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to set default'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
