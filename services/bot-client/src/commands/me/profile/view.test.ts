/**
 * Tests for Profile View Handler
 * Tests gateway API calls and response rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleViewPersona } from './view.js';
import { MessageFlags } from 'discord.js';

// Mock gateway client
const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', () => ({
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

describe('handleViewPersona', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction() {
    return {
      user: { id: '123456789' },
      reply: mockReply,
    } as any;
  }

  it('should show error when user has no personas', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: { personas: [] },
    });

    await handleViewPersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have a profile"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show error when no default persona is set', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        personas: [
          { id: 'persona-1', name: 'Test', isDefault: false },
          { id: 'persona-2', name: 'Other', isDefault: false },
        ],
      },
    });

    await handleViewPersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have a default profile"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should display profile with all fields', async () => {
    // First call returns persona list
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        personas: [{ id: 'persona-123', name: 'Test Profile', isDefault: true }],
      },
    });
    // Second call returns persona details
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'persona-123',
        name: 'Test Profile',
        preferredName: 'TestUser',
        pronouns: 'they/them',
        content: 'I am a test user who loves programming',
        description: 'Test description',
        shareLtmAcrossPersonalities: false,
      },
    });

    await handleViewPersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🎭 Your Profile',
          }),
        }),
      ],
      components: [], // No expand button for short content
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should show LTM sharing enabled when flag is true', async () => {
    // First call returns persona list
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        personas: [{ id: 'persona-123', name: 'Test Profile', isDefault: true }],
      },
    });
    // Second call returns persona details
    mockCallGatewayApi.mockResolvedValueOnce({
      ok: true,
      data: {
        id: 'persona-123',
        name: 'Test Profile',
        preferredName: null,
        pronouns: null,
        content: '',
        description: null,
        shareLtmAcrossPersonalities: true,
      },
    });

    await handleViewPersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalled();
    const call = mockReply.mock.calls[0][0];
    const embed = call.embeds[0];
    const fields = embed.data.fields;
    const ltmField = fields.find((f: { name: string }) => f.name.includes('LTM'));

    expect(ltmField?.value).toContain('Enabled');
  });

  it('should handle gateway API errors gracefully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Gateway error',
    });

    await handleViewPersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to retrieve'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleViewPersona(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to retrieve'),
      flags: MessageFlags.Ephemeral,
    });
  });
});
