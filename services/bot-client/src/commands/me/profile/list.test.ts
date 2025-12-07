/**
 * Tests for Profile List Handler
 * Tests gateway API calls and response rendering.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleListPersonas } from './list.js';
import { MessageFlags } from 'discord.js';
import { mockListPersonasResponse } from '@tzurot/common-types';

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

describe('handleListPersonas', () => {
  const mockReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction() {
    return {
      user: { id: '123456789', username: 'testuser' },
      reply: mockReply,
    } as any;
  }

  it('should show empty state when user has no profiles', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([]),
    });

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have any profiles yet"),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should handle gateway API errors gracefully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Gateway error',
    });

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to load'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should list user personas with embed', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        {
          name: 'Default Persona',
          preferredName: 'Alice',
          pronouns: 'she/her',
          content: 'I love coding',
          isDefault: true,
        },
        {
          name: 'Work Persona',
          preferredName: 'Professional Alice',
          pronouns: null,
          content: null,
          isDefault: false,
        },
      ]),
    });

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      embeds: expect.arrayContaining([
        expect.objectContaining({
          data: expect.objectContaining({
            title: '📋 Your Profiles',
          }),
        }),
      ]),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should mark default persona with star', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        {
          name: 'My Persona',
          preferredName: null,
          pronouns: null,
          content: null,
          isDefault: true,
        },
      ]),
    });

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalled();
    const call = mockReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    // The field name should contain star for default
    expect(embed.fields[0].name).toContain('⭐');
    expect(embed.fields[0].name).toContain('(default)');
  });

  it('should show persona count in description', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        {
          name: 'Persona 1',
          preferredName: null,
          pronouns: null,
          content: null,
          isDefault: false,
        },
        {
          name: 'Persona 2',
          preferredName: null,
          pronouns: null,
          content: null,
          isDefault: false,
        },
        {
          name: 'Persona 3',
          preferredName: null,
          pronouns: null,
          content: null,
          isDefault: false,
        },
      ]),
    });

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalled();
    const call = mockReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    expect(embed.description).toContain('3');
    expect(embed.description).toContain('profiles');
  });

  it('should handle network errors gracefully', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Failed to load'),
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should truncate long content in preview', async () => {
    const longContent = 'x'.repeat(200);
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListPersonasResponse([
        {
          name: 'Long Content Persona',
          preferredName: null,
          pronouns: null,
          content: longContent,
          isDefault: false,
        },
      ]),
    });

    await handleListPersonas(createMockInteraction());

    expect(mockReply).toHaveBeenCalled();
    const call = mockReply.mock.calls[0][0];
    const embed = call.embeds[0].data;
    expect(embed.fields[0].value).toContain('...');
  });
});
