/**
 * Tests for Usage Command
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execute, handleUsage } from './usage.js';

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
const mockDeferEphemeral = vi.fn();
const mockReplyWithError = vi.fn();
const mockHandleCommandError = vi.fn();
vi.mock('../../utils/commandHelpers.js', () => ({
  deferEphemeral: (...args: unknown[]) => mockDeferEphemeral(...args),
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
}));

describe('Usage Command', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(period?: string) {
    return {
      user: { id: '123456789' },
      options: {
        getString: (name: string) => {
          if (name === 'period') return period ?? null;
          return null;
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof execute>[0];
  }

  describe('execute', () => {
    it('should call handleUsage', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          period: 'month',
          totalRequests: 0,
          totalTokensIn: 0,
          totalTokensOut: 0,
          totalTokens: 0,
          byProvider: {},
          byModel: {},
          byRequestType: {},
        },
      });

      const interaction = createMockInteraction();
      await execute(interaction);

      expect(mockDeferEphemeral).toHaveBeenCalled();
      expect(mockCallGatewayApi).toHaveBeenCalled();
    });
  });

  describe('handleUsage', () => {
    it('should display usage stats with no requests', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          period: 'month',
          totalRequests: 0,
          totalTokensIn: 0,
          totalTokensOut: 0,
          totalTokens: 0,
          byProvider: {},
          byModel: {},
          byRequestType: {},
        },
      });

      const interaction = createMockInteraction('month');
      await handleUsage(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/usage?period=month', {
        userId: '123456789',
      });
      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          data: expect.objectContaining({
            title: '📊 Your Usage Statistics',
            fields: expect.arrayContaining([
              expect.objectContaining({ name: 'No Usage' }),
            ]),
          }),
        })],
      });
    });

    it('should display usage stats with requests', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          period: 'week',
          totalRequests: 50,
          totalTokensIn: 10000,
          totalTokensOut: 5000,
          totalTokens: 15000,
          byProvider: {
            openrouter: { requests: 50, tokensIn: 10000, tokensOut: 5000 },
          },
          byModel: {
            'anthropic/claude-sonnet-4': { requests: 30, tokensIn: 6000, tokensOut: 3000 },
            'openai/gpt-4o': { requests: 20, tokensIn: 4000, tokensOut: 2000 },
          },
          byRequestType: {
            chat: { requests: 45 },
            voice: { requests: 5 },
          },
        },
      });

      const interaction = createMockInteraction('week');
      await handleUsage(interaction);

      expect(mockEditReply).toHaveBeenCalledWith({
        embeds: [expect.objectContaining({
          data: expect.objectContaining({
            title: '📊 Your Usage Statistics',
            fields: expect.arrayContaining([
              expect.objectContaining({ name: 'Total Requests', value: '50' }),
              expect.objectContaining({ name: 'Tokens In' }),
              expect.objectContaining({ name: 'Tokens Out' }),
              expect.objectContaining({ name: 'By Provider' }),
              expect.objectContaining({ name: 'By Type' }),
              expect.objectContaining({ name: 'Top Models' }),
            ]),
          }),
        })],
      });
    });

    it('should use default period when not specified', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: true,
        data: {
          period: 'month',
          totalRequests: 0,
          totalTokensIn: 0,
          totalTokensOut: 0,
          totalTokens: 0,
          byProvider: {},
          byModel: {},
          byRequestType: {},
        },
      });

      const interaction = createMockInteraction(); // No period
      await handleUsage(interaction);

      expect(mockCallGatewayApi).toHaveBeenCalledWith('/user/usage?period=month', {
        userId: '123456789',
      });
    });

    it('should handle API error', async () => {
      mockCallGatewayApi.mockResolvedValue({
        ok: false,
        status: 500,
        error: 'Server error',
      });

      const interaction = createMockInteraction();
      await handleUsage(interaction);

      expect(mockReplyWithError).toHaveBeenCalledWith(
        interaction,
        'Failed to get usage statistics. Please try again later.'
      );
    });

    it('should handle exceptions', async () => {
      const error = new Error('Network error');
      mockCallGatewayApi.mockRejectedValue(error);

      const interaction = createMockInteraction();
      await handleUsage(interaction);

      expect(mockHandleCommandError).toHaveBeenCalledWith(
        interaction,
        error,
        { userId: '123456789', command: 'Usage' }
      );
    });
  });
});
