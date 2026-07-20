/**
 * Tests for Wallet Browse Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChatInputCommandInteraction } from 'discord.js';
import { handleBrowse } from './browse.js';
import { AIProvider } from '@tzurot/common-types/constants/ai';
import { mockListWalletKeysResponse } from '@tzurot/test-factories';
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
  listWalletKeys: vi.fn(),
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

describe('handleBrowse', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockContext(): DeferredCommandContext {
    const mockInteraction = {
      user: { id: '123456789', username: 'testuser' },
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
      getSubcommand: vi.fn().mockReturnValue('browse'),
      getSubcommandGroup: vi.fn().mockReturnValue(null),
    } as unknown as DeferredCommandContext;
  }

  it('should browse keys successfully', async () => {
    stub.listWalletKeys.mockResolvedValue(
      makeOk(
        mockListWalletKeysResponse([
          {
            provider: AIProvider.OpenRouter,
            isActive: true,
            createdAt: '2025-01-01T00:00:00Z',
            lastUsedAt: '2025-01-15T12:00:00Z',
          },
        ])
      )
    );

    const context = createMockContext();
    await handleBrowse(context);

    expect(stub.listWalletKeys).toHaveBeenCalled();
    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '💳 API Keys',
          }),
        }),
      ],
    });
  });

  it('should show empty state when no keys configured', async () => {
    stub.listWalletKeys.mockResolvedValue(makeOk(mockListWalletKeysResponse([])));

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            title: '💳 API Keys',
            description: expect.stringContaining('no API keys configured'),
          }),
        }),
      ],
    });
  });

  it('should handle API error', async () => {
    stub.listWalletKeys.mockResolvedValue(makeErr(500, 'Server error'));

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ Failed to retrieve wallet info: Server error',
    });
  });

  it('should handle exceptions', async () => {
    stub.listWalletKeys.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      content: '❌ An unexpected error occurred. Please try again.',
    });
  });

  it('should show active badge for active keys', async () => {
    stub.listWalletKeys.mockResolvedValue(
      makeOk(
        mockListWalletKeysResponse([
          {
            provider: AIProvider.OpenRouter,
            isActive: true,
            createdAt: '2025-01-01T00:00:00Z',
            lastUsedAt: '2025-01-15T12:00:00Z',
          },
        ])
      )
    );

    const context = createMockContext();
    await handleBrowse(context);

    expect(mockEditReply).toHaveBeenCalledWith({
      embeds: [
        expect.objectContaining({
          data: expect.objectContaining({
            // Description should contain the active badge (✅ — registry ACTIVE;
            // ⭐ means "default", which a wallet key is not)
            description: expect.stringContaining('✅'),
          }),
        }),
      ],
    });
  });

  it('renders the §2.4 row grammar (bold name + provider slug techId)', async () => {
    stub.listWalletKeys.mockResolvedValue(
      makeOk(
        mockListWalletKeysResponse([
          {
            provider: AIProvider.OpenRouter,
            isActive: true,
            createdAt: '2025-01-01T00:00:00Z',
            lastUsedAt: null,
          },
        ])
      )
    );

    const context = createMockContext();
    await handleBrowse(context);

    const embedData = mockEditReply.mock.calls[0][0].embeds[0].data;
    expect(embedData.description).toContain('**1.** ✅ **OpenRouter** (`openrouter`)');
    expect(embedData.description).toContain('└ Active · Last used Never');
    expect(embedData.footer.text).toContain('1 key');
    expect(embedData.footer.text).toContain('Active ✅');
  });
});
