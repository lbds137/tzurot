/**
 * Tests for Wallet Remove Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleRemoveKey } from './remove.js';
import { mockRemoveWalletKeyResponse, AIProvider } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

// Mock common-types
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

// Mock userGatewayClient
const mockCallGatewayApi = vi.fn();
vi.mock('../../utils/userGatewayClient.js', () => ({
  callGatewayApi: (...args: unknown[]) => mockCallGatewayApi(...args),
}));

// Mock providers
vi.mock('../../utils/providers.js', () => ({
  getProviderDisplayName: (provider: string) => {
    const names: Record<string, string> = {
      openrouter: 'OpenRouter',
    };
    return names[provider] ?? provider;
  },
}));

describe('handleRemoveKey', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(provider: string = 'openrouter'): DeferredCommandContext {
    const mockInteraction = {
      user: { id: '123456789' },
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'provider') return provider;
          return null;
        },
      },
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
      commandName: 'wallet',
      isEphemeral: true,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
      getOption: vi.fn(),
      getRequiredOption: vi.fn(),
      getSubcommand: vi.fn().mockReturnValue('remove'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
    } as unknown as DeferredCommandContext;
  }

  it('should remove key successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockRemoveWalletKeyResponse({
        provider: AIProvider.OpenRouter,
      }),
    });

    const context = createMockContext('openrouter');
    await handleRemoveKey(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/wallet/openrouter', {
      method: 'DELETE',
      userId: '123456789',
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '🗑️ API Key Removed',
            description: expect.stringContaining('OpenRouter'),
          }),
        }),
      ],
    });
  });

  it('should handle 404 key not found', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Not found',
    });

    const context = createMockContext('openrouter');
    await handleRemoveKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an API key configured for **OpenRouter**"),
    });
  });

  it('should handle generic API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Internal error',
    });

    const context = createMockContext('openrouter');
    await handleRemoveKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to remove API key: Internal error',
    });
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const context = createMockContext();
    await handleRemoveKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An unexpected error occurred. Please try again.',
    });
  });
});
