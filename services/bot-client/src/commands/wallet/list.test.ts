/**
 * Tests for Wallet List Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleListKeys } from './list.js';
import { mockListWalletKeysResponse, AIProvider } from '@tzurot/common-types';
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

describe('handleListKeys', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(): DeferredCommandContext {
    const mockInteraction = {
      user: { id: '123456789' },
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
      getSubcommand: vi.fn().mockReturnValue('list'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
    } as unknown as DeferredCommandContext;
  }

  it('should list keys successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListWalletKeysResponse([
        {
          provider: AIProvider.OpenRouter,
          isActive: true,
          createdAt: '2025-01-01T00:00:00Z',
          lastUsedAt: '2025-01-15T12:00:00Z',
        },
      ]),
    });

    const context = createMockContext();
    await handleListKeys(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith('/wallet/list', { userId: '123456789' });
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '💳 Your API Wallet',
            description: expect.stringContaining('1'),
          }),
        }),
      ],
    });
  });

  it('should show empty state when no keys configured', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListWalletKeysResponse([]),
    });

    const context = createMockContext();
    await handleListKeys(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '💳 Your API Wallet',
            description: expect.stringContaining('no API keys configured'),
          }),
        }),
      ],
    });
  });

  it('should handle API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Server error',
    });

    const context = createMockContext();
    await handleListKeys(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to retrieve wallet info: Server error',
    });
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const context = createMockContext();
    await handleListKeys(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An unexpected error occurred. Please try again.',
    });
  });

  it('should handle single key with correct pluralization', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: mockListWalletKeysResponse([
        {
          provider: AIProvider.OpenRouter,
          isActive: true,
          createdAt: '2025-01-01T00:00:00Z',
          lastUsedAt: '2025-01-15T12:00:00Z',
        },
      ]),
    });

    const context = createMockContext();
    await handleListKeys(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            description: expect.stringContaining('1'),
          }),
        }),
      ],
    });
  });
});
