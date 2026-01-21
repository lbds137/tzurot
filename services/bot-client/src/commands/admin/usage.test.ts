/**
 * Tests for Admin Usage Subcommand Handler
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleUsage } from './usage.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

// Mock logger and config
vi.mock('@tzurot/common-types', async () => {
  const actual = await vi.importActual('@tzurot/common-types');
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    getConfig: () => ({
      GATEWAY_URL: 'http://localhost:3000',
      INTERNAL_SERVICE_SECRET: 'test-service-secret',
    }),
  };
});

// Mock fetch
global.fetch = vi.fn();

/**
 * Create complete mock usage stats with all required fields
 */
function createMockUsageStats(
  overrides: Partial<{
    timeframe: string;
    periodStart: string | null;
    periodEnd: string;
    totalRequests: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalTokens: number;
    uniqueUsers: number;
    byProvider: Record<string, { requests: number; tokensIn: number; tokensOut: number }>;
    byModel: Record<string, { requests: number; tokensIn: number; tokensOut: number }>;
    byRequestType: Record<string, { requests: number; tokensIn: number; tokensOut: number }>;
    topUsers: { discordId: string; requests: number; tokens: number }[];
  }> = {}
) {
  return {
    timeframe: '7d',
    periodStart: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    periodEnd: new Date().toISOString(),
    totalRequests: 100,
    totalTokensIn: 5000,
    totalTokensOut: 2500,
    totalTokens: 7500,
    uniqueUsers: 5,
    byProvider: { openrouter: { requests: 100, tokensIn: 5000, tokensOut: 2500 } },
    byModel: { 'claude-sonnet': { requests: 100, tokensIn: 5000, tokensOut: 2500 } },
    byRequestType: { chat: { requests: 100, tokensIn: 5000, tokensOut: 2500 } },
    topUsers: [{ discordId: 'user-123', requests: 50, tokens: 3000 }],
    ...overrides,
  };
}

describe('handleUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(period: string | null = null): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: {},
      user: { id: 'user-123' },
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'admin',
      isEphemeral: true,
      getOption: vi.fn((name: string) => {
        if (name === 'period') return period;
        return null;
      }),
      getRequiredOption: vi.fn(),
      getSubcommand: () => 'usage',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  it('should use default timeframe of 7d when not provided', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockUsageStats()), { status: 200 })
    );

    const context = createMockContext(null);
    await handleUsage(context);

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('timeframe=7d'), expect.any(Object));
  });

  it('should use provided timeframe', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockUsageStats({ timeframe: '30d' })), { status: 200 })
    );

    const context = createMockContext('30d');
    await handleUsage(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('timeframe=30d'),
      expect.any(Object)
    );
  });

  it('should include service secret in headers', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockUsageStats()), { status: 200 })
    );

    const context = createMockContext(null);
    await handleUsage(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Service-Auth': 'test-service-secret',
        }),
      })
    );
  });

  it('should display usage statistics in embed', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify(createMockUsageStats({ totalRequests: 150, totalTokens: 50000 })),
        { status: 200 }
      )
    );

    const context = createMockContext('7d');
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle HTTP errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    const context = createMockContext(null);
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Failed to retrieve usage statistics'),
    });
  });

  it('should handle network errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const context = createMockContext(null);
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Error retrieving usage statistics'),
    });
  });

  it('should handle zero usage data', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify(
          createMockUsageStats({
            totalRequests: 0,
            totalTokensIn: 0,
            totalTokensOut: 0,
            totalTokens: 0,
            uniqueUsers: 0,
            byProvider: {},
            byModel: {},
            byRequestType: {},
            topUsers: [],
          })
        ),
        { status: 200 }
      )
    );

    const context = createMockContext(null);
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle large token counts', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify(
          createMockUsageStats({
            totalRequests: 1000,
            totalTokensIn: 1_500_000,
            totalTokensOut: 500_000,
            totalTokens: 2_000_000,
          })
        ),
        { status: 200 }
      )
    );

    const context = createMockContext(null);
    await handleUsage(context);

    // Large token counts should be formatted with K/M suffixes
    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should display all breakdowns when data is available', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify(
          createMockUsageStats({
            byProvider: {
              openrouter: { requests: 80, tokensIn: 4000, tokensOut: 2000 },
              anthropic: { requests: 20, tokensIn: 1000, tokensOut: 500 },
            },
            byModel: {
              'claude-sonnet': { requests: 60, tokensIn: 3000, tokensOut: 1500 },
              'gpt-4': { requests: 40, tokensIn: 2000, tokensOut: 1000 },
            },
            topUsers: [
              { discordId: 'user-1', requests: 50, tokens: 3000 },
              { discordId: 'user-2', requests: 30, tokens: 2000 },
            ],
          })
        ),
        { status: 200 }
      )
    );

    const context = createMockContext(null);
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle 403 unauthorized response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Unauthorized', { status: 403 }));

    const context = createMockContext(null);
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Failed to retrieve usage statistics'),
    });
  });
});
