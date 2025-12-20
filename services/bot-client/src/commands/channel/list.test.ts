/**
 * Tests for /channel list subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleList } from './list.js';

// Mock gateway client
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: vi.fn(),
}));

// Mock logger
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

import { callGatewayApi } from '../../utils/userGatewayClient.js';

describe('/channel list', () => {
  const mockCallGatewayApi = vi.mocked(callGatewayApi);

  function createMockInteraction(): ChatInputCommandInteraction {
    return {
      user: { id: 'user-123' },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should list activations successfully', async () => {
    const interaction = createMockInteraction();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        activations: [
          {
            id: 'activation-1',
            channelId: '111111111111111111',
            personalitySlug: 'personality-one',
            personalityName: 'Personality One',
            activatedBy: 'user-uuid',
            createdAt: '2024-01-01T00:00:00.000Z',
          },
          {
            id: 'activation-2',
            channelId: '222222222222222222',
            personalitySlug: 'personality-two',
            personalityName: 'Personality Two',
            activatedBy: 'user-uuid',
            createdAt: '2024-01-02T00:00:00.000Z',
          },
        ],
      },
    });

    await handleList(interaction);

    // deferReply is now handled at top-level interactionCreate handler
    expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/channel/list', {
      userId: 'user-123',
      method: 'GET',
    });

    // Check that editReply was called with an embed
    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      })
    );
  });

  it('should show message when no activations exist', async () => {
    const interaction = createMockInteraction();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        activations: [],
      },
    });

    await handleList(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No channels have activated personalities')
    );
  });

  it('should handle API errors', async () => {
    const interaction = createMockInteraction();
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      error: 'Database error',
      status: 500,
    });

    await handleList(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to list activations')
    );
  });

  it('should handle unexpected errors', async () => {
    const interaction = createMockInteraction();
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleList(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('unexpected error'));
  });

  it('should display single activation correctly', async () => {
    const interaction = createMockInteraction();
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        activations: [
          {
            id: 'activation-1',
            channelId: '111111111111111111',
            personalitySlug: 'test-char',
            personalityName: 'Test Character',
            activatedBy: 'user-uuid',
            createdAt: '2024-06-15T12:00:00.000Z',
          },
        ],
      },
    });

    await handleList(interaction);

    expect(interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([expect.any(EmbedBuilder)]),
      })
    );
  });
});
