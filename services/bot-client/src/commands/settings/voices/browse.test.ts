/**
 * Tests for Voice Browse Handler
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleBrowseVoices } from './browse.js';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';

vi.mock('@tzurot/common-types', async importOriginal => {
  const actual = await importOriginal<typeof import('@tzurot/common-types')>();
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

const mockCallGatewayApi = vi.fn();
vi.mock('../../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
  GATEWAY_TIMEOUTS: { AUTOCOMPLETE: 2500, DEFERRED: 10000 },
}));

describe('handleBrowseVoices', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(): DeferredCommandContext {
    const mockInteraction = {
      user: { id: 'user-123' },
      editReply: mockEditReply,
    } as unknown as ChatInputCommandInteraction;

    return {
      interaction: mockInteraction,
      user: mockInteraction.user,
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'settings',
      isEphemeral: true,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('browse'),
      getSubcommandGroup: vi.fn().mockReturnValue('voices'),
    } as unknown as DeferredCommandContext;
  }

  it('should list voices successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices: [
          { voiceId: 'v1', name: 'tzurot-alice', slug: 'alice' },
          { voiceId: 'v2', name: 'tzurot-bob', slug: 'bob' },
        ],
        totalSlots: 10,
        tzurotCount: 2,
      },
    });

    await handleBrowseVoices(createMockContext());

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/voices',
      expect.objectContaining({ userId: 'user-123' })
    );
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🎤 Cloned Voices',
            description: expect.stringContaining('alice'),
          }),
        }),
      ],
    });
  });

  it('should show empty state when no voices', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        voices: [],
        totalSlots: 5,
        tzurotCount: 0,
      },
    });

    await handleBrowseVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('No Tzurot-cloned voices'),
          }),
        }),
      ],
    });
  });

  it('should handle API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'ElevenLabs API key not found',
    });

    await handleBrowseVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ ElevenLabs API key not found',
    });
  });

  it('should handle exceptions', async () => {
    mockCallGatewayApi.mockRejectedValue(new Error('Network error'));

    await handleBrowseVoices(createMockContext());

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An unexpected error occurred. Please try again.',
    });
  });
});
