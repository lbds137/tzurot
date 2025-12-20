/**
 * Tests for Wallet List Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleListKeys } from './list.js';
import { mockListWalletKeysResponse, AIProvider } from '@tzurot/common-types';

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

// Mock commandHelpers
const mockReplyWithError = vi.fn();
const mockHandleCommandError = vi.fn();
vi.mock('../../utils/commandHelpers.js', () => ({
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
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

  function createMockInteraction() {
    return {
      user: { id: '123456789' },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleListKeys>[0];
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

    const interaction = createMockInteraction();
    await handleListKeys(interaction);

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

    const interaction = createMockInteraction();
    await handleListKeys(interaction);

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

    const interaction = createMockInteraction();
    await handleListKeys(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      'Failed to retrieve wallet info: Server error'
    );
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const interaction = createMockInteraction();
    await handleListKeys(interaction);

    expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
      userId: '123456789',
      command: 'Wallet List',
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

    const interaction = createMockInteraction();
    await handleListKeys(interaction);

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
