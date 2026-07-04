/**
 * Tests for Wallet Remove Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleRemoveKey } from './remove.js';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { mockRemoveWalletKeyResponse } from '@tzurot/test-factories';
import type { DeferredCommandContext } from '../../../utils/commandContext/types.js';
import { makeOk, makeErr } from '../../../test/gatewayClientStubs.js';
import type { UserClient } from '@tzurot/clients';

// Mock common-types
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

const stub = {
  removeWalletKey: vi.fn(),
};

vi.mock('../../../utils/gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: stub as unknown as UserClient })),
}));

// Mock providers
vi.mock('../../../utils/providers.js', () => ({
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
    stub.removeWalletKey.mockReset();
  });

  function createMockContext(provider: string = 'openrouter'): DeferredCommandContext {
    const mockInteraction = {
      user: { id: '123456789', username: 'testuser' },
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
    stub.removeWalletKey.mockResolvedValue(
      makeOk(mockRemoveWalletKeyResponse({ provider: AIProvider.OpenRouter }))
    );

    const context = createMockContext('openrouter');
    await handleRemoveKey(context);

    expect(stub.removeWalletKey).toHaveBeenCalledWith('openrouter');
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
    stub.removeWalletKey.mockResolvedValue(makeErr(404, 'Not found'));

    const context = createMockContext('openrouter');
    await handleRemoveKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an API key configured for **OpenRouter**"),
    });
  });

  it('should handle generic API error', async () => {
    stub.removeWalletKey.mockResolvedValue(makeErr(500, 'Internal error'));

    const context = createMockContext('openrouter');
    await handleRemoveKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to remove API key: Internal error',
    });
  });

  it('should handle exceptions', async () => {
    stub.removeWalletKey.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleRemoveKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An unexpected error occurred. Please try again.',
    });
  });
});
