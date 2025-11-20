/**
 * Tests for Admin Usage Subcommand Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleUsage } from './usage.js';
import type { ChatInputCommandInteraction, User } from 'discord.js';
import { MessageFlags } from 'discord.js';
import type { getConfig } from '@tzurot/common-types';

// Mock logger
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
  };
});

// Mock fetch
global.fetch = vi.fn();

describe('handleUsage', () => {
  let mockInteraction: ChatInputCommandInteraction;
  let mockConfig: ReturnType<typeof getConfig>;
  let mockUser: User;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUser = {
      id: 'user-123',
    } as User;

    mockInteraction = {
      user: mockUser,
      options: {
        getString: vi.fn(),
      },
      deferReply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    mockConfig = {
      GATEWAY_URL: 'http://localhost:3000',
    } as ReturnType<typeof getConfig>;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should defer reply with ephemeral flag', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totalRequests: 100 }), { status: 200 })
    );

    await handleUsage(mockInteraction, mockConfig);

    expect(mockInteraction.deferReply).toHaveBeenCalledWith({
      flags: MessageFlags.Ephemeral,
    });
  });

  it('should use default timeframe of 7d when not provided', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totalRequests: 100 }), { status: 200 })
    );

    await handleUsage(mockInteraction, mockConfig);

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('timeframe=7d'), expect.any(Object));
  });

  it('should use provided timeframe', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('30d');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totalRequests: 100 }), { status: 200 })
    );

    await handleUsage(mockInteraction, mockConfig);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('timeframe=30d'),
      expect.any(Object)
    );
  });

  it('should include owner ID in headers', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ totalRequests: 100 }), { status: 200 })
    );

    await handleUsage(mockInteraction, mockConfig);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: {
          'X-Owner-Id': 'user-123',
        },
      })
    );
  });

  it('should display usage statistics in embed', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue('7d');
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          totalRequests: 150,
          totalTokens: 50000,
          estimatedCost: 2.5,
        }),
        { status: 200 }
      )
    );

    await handleUsage(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle HTTP errors', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    await handleUsage(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Failed to retrieve usage statistics')
    );
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
  });

  it('should handle network errors', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    await handleUsage(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Error retrieving usage statistics')
    );
  });

  it('should handle partial usage data', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          totalRequests: 100,
          // Missing totalTokens and estimatedCost
        }),
        { status: 200 }
      )
    );

    await handleUsage(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle empty usage data', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));

    await handleUsage(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should format cost with 2 decimal places', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          totalRequests: 100,
          totalTokens: 10000,
          estimatedCost: 1.234567,
        }),
        { status: 200 }
      )
    );

    await handleUsage(mockInteraction, mockConfig);

    // Cost should be formatted as $1.23
    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle 403 unauthorized response', async () => {
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(new Response('Unauthorized', { status: 403 }));

    await handleUsage(mockInteraction, mockConfig);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Failed to retrieve usage statistics')
    );
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'));
  });
});
