/**
 * Tests for Wallet Test Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleTestKey } from './test.js';
import { mockTestWalletKeyResponse, AIProvider } from '@tzurot/common-types';

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

describe('handleTestKey', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(provider: string = 'openrouter') {
    return {
      user: { id: '123456789' },
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'provider') return provider;
          return null;
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleTestKey>[0];
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

    const interaction = createMockInteraction('openrouter');
    await handleTestKey(interaction);

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

    const interaction = createMockInteraction('openrouter');
    await handleTestKey(interaction);

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

    const interaction = createMockInteraction('openrouter');
    await handleTestKey(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      expect.stringContaining("don't have an API key configured for **OpenRouter**")
    );
  });

  it('should handle validation failure', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 401,
      error: 'Invalid API key',
    });

    const interaction = createMockInteraction('openrouter');
    await handleTestKey(interaction);

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

    const interaction = createMockInteraction();
    await handleTestKey(interaction);

    expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
      userId: '123456789',
      command: 'Wallet Test',
    });
  });
});
