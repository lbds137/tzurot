/**
 * Tests for Wallet Test Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleTestKey } from './test.js';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { mockTestWalletKeyResponse } from '@tzurot/test-factories';
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
  testWalletKey: vi.fn(),
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

describe('handleTestKey', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    stub.testWalletKey.mockReset();
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
      getSubcommand: vi.fn().mockReturnValue('test'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
    } as unknown as DeferredCommandContext;
  }

  it('should test key successfully with credits', async () => {
    stub.testWalletKey.mockResolvedValue(
      makeOk(
        mockTestWalletKeyResponse({
          valid: true,
          provider: AIProvider.OpenRouter,
          credits: 12.5,
        })
      )
    );

    const context = createMockContext('openrouter');
    await handleTestKey(context);

    expect(stub.testWalletKey).toHaveBeenCalledWith({ provider: 'openrouter' });
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
    stub.testWalletKey.mockResolvedValue(
      makeOk(
        mockTestWalletKeyResponse({
          valid: true,
          provider: AIProvider.OpenRouter,
        })
      )
    );

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
    stub.testWalletKey.mockResolvedValue(makeErr(404, 'Not found'));

    const context = createMockContext('openrouter');
    await handleTestKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining("don't have an API key configured for **OpenRouter**"),
    });
  });

  it('should handle validation failure', async () => {
    stub.testWalletKey.mockResolvedValue(makeErr(401, 'Invalid API key'));

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

  it('should map a 429 rate-limit to a retry message, not "API Key Invalid"', async () => {
    stub.testWalletKey.mockResolvedValue(makeErr(429, 'Too many API key operations'));

    const context = createMockContext('openrouter');
    await handleTestKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Too many key operations'),
    });
    // Must NOT render the alarming validation-failure embed for a mere throttle.
    expect(mockEditReply).not.toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.arrayContaining([
          expect.objectContaining({
            data: expect.objectContaining({ title: '❌ API Key Invalid' }),
          }),
        ]),
      })
    );
  });

  it('should handle exceptions', async () => {
    stub.testWalletKey.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleTestKey(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An unexpected error occurred. Please try again.',
    });
  });
});
