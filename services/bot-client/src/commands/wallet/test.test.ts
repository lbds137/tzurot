/**
 * Tests for Wallet Test Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleTestKey } from './test.js';
import { mockTestWalletKeyResponse, AIProvider } from '@tzurot/common-types';
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

describe('handleTestKey', () => {
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
      getSubcommand: vi.fn().mockReturnValue('test'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
    } as unknown as DeferredCommandContext;
  }

  it('should test key successfully with credits', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockTestWalletKeyResponse({
        valid: true,
        provider: AIProvider.OpenRouter,
        credits: 12.5,
      }),
    });

    const context = createMockContext('openrouter');
    await handleTestKey(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/wallet/test', {
      method: 'POST',
      userId: '123456789',
      body: { provider: 'openrouter' },
    });
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '✅ API Key Valid',
            description: expect.stringContaining('OpenRouter'),
          }),
        }),
      ],
    });
  });

  it('should test key successfully without credits info', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockTestWalletKeyResponse({
        valid: true,
        provider: AIProvider.OpenRouter,
      }),
    });

    const context = createMockContext('openrouter');
    await handleTestKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '✅ API Key Valid',
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
    await handleTestKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an API key configured for **OpenRouter**"),
    });
  });

  it('should handle validation failure', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Invalid API key',
    });

    const context = createMockContext('openrouter');
    await handleTestKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '❌ API Key Invalid',
          }),
        }),
      ],
    });
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const context = createMockContext();
    await handleTestKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An unexpected error occurred. Please try again.',
    });
  });
});
