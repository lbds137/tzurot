/**
 * Tests for Admin Usage Subcommand Handler
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeErr } from '../../test/gatewayClientStubs.js';
import type { GatewayResult, OwnerClient } from '@tzurot/clients';
import { handleUsage } from './usage.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({
      info: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  };
});

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

interface StubClient {
  getAdminUsageStats: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return { getAdminUsageStats: vi.fn() };
}

function asOwnerClient(stub: StubClient): OwnerClient {
  return stub as unknown as OwnerClient;
}

function ok<T>(data: T): GatewayResult<T> {
  return { ok: true, data };
}

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
  let stub: StubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubClient();
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockContext(period: string | null = null): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);
    return {
      interaction: {
        user: { id: 'user-123' },
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'period') return period;
            return null;
          }),
          getBoolean: vi.fn(() => null),
          getInteger: vi.fn(() => null),
        },
      },
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
    stub.getAdminUsageStats.mockResolvedValue(ok(createMockUsageStats()));

    const context = createMockContext(null);
    await handleUsage(context);

    expect(stub.getAdminUsageStats).toHaveBeenCalledWith({ timeframe: '7d' });
  });

  it('should use provided timeframe', async () => {
    stub.getAdminUsageStats.mockResolvedValue(ok(createMockUsageStats({ timeframe: '30d' })));

    const context = createMockContext('30d');
    await handleUsage(context);

    expect(stub.getAdminUsageStats).toHaveBeenCalledWith({ timeframe: '30d' });
  });

  it('should display usage statistics in embed', async () => {
    stub.getAdminUsageStats.mockResolvedValue(
      ok(createMockUsageStats({ totalRequests: 150, totalTokens: 50000 }))
    );

    const context = createMockContext('7d');
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle HTTP errors', async () => {
    stub.getAdminUsageStats.mockResolvedValue(makeErr(500, 'Internal Server Error'));

    const context = createMockContext(null);
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Failed to retrieve usage statistics'),
    });
  });

  it('should handle network errors', async () => {
    stub.getAdminUsageStats.mockRejectedValue(new Error('Network error'));

    const context = createMockContext(null);
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Error retrieving usage statistics'),
    });
  });

  it('should handle zero usage data', async () => {
    stub.getAdminUsageStats.mockResolvedValue(
      ok(
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
      )
    );

    const context = createMockContext(null);
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle large token counts', async () => {
    stub.getAdminUsageStats.mockResolvedValue(
      ok(
        createMockUsageStats({
          totalRequests: 1000,
          totalTokensIn: 1_500_000,
          totalTokensOut: 500_000,
          totalTokens: 2_000_000,
        })
      )
    );

    const context = createMockContext(null);
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should display all breakdowns when data is available', async () => {
    stub.getAdminUsageStats.mockResolvedValue(
      ok(
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
      )
    );

    const context = createMockContext(null);
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle 403 unauthorized response', async () => {
    stub.getAdminUsageStats.mockResolvedValue(makeErr(403, 'Unauthorized'));

    const context = createMockContext(null);
    await handleUsage(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Failed to retrieve usage statistics'),
    });
  });
});
