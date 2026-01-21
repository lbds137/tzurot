/**
 * Tests for History Stats Subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { handleStats } from './stats.js';

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
const mockCreateInfoEmbed = vi.fn(() => ({
  addFields: vi.fn().mockReturnThis(),
}));
vi.mock('../../utils/commandHelpers.js', () => ({
  createInfoEmbed: (...args: unknown[]) => mockCreateInfoEmbed(...args),
}));

describe('handleStats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(
    personalitySlug: string = 'lilith',
    channelId: string = 'channel-123'
  ): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: {},
      user: { id: '123456789' },
      guild: null,
      member: null,
      channel: null,
      channelId,
      guildId: null,
      commandName: 'history',
      isEphemeral: true,
      getOption: vi.fn((name: string) => {
        if (name === 'profile') return null;
        return null;
      }),
      getRequiredOption: vi.fn((name: string) => {
        if (name === 'personality') return personalitySlug;
        throw new Error(`Unknown required option: ${name}`);
      }),
      getSubcommand: () => 'stats',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  it('should get stats successfully', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        channelId: 'channel-123',
        personalitySlug: 'lilith',
        personaId: 'persona-123',
        personaName: 'My Profile',
        visible: {
          totalMessages: 10,
          userMessages: 5,
          assistantMessages: 5,
          oldestMessage: '2025-12-10T08:00:00.000Z',
          newestMessage: '2025-12-13T10:30:00.000Z',
        },
        hidden: { count: 3 },
        total: { totalMessages: 13, oldestMessage: '2025-12-01T08:00:00.000Z' },
        contextEpoch: null,
        canUndo: false,
      },
    });

    const context = createMockContext();
    await handleStats(context);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/history/stats?personalitySlug=lilith&channelId=channel-123',
      { userId: '123456789', method: 'GET' }
    );
    expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
      'Conversation Statistics',
      expect.stringContaining('lilith')
    );
    expect(context.editReply).toHaveBeenCalledWith({ embeds: [expect.any(Object)] });
  });

  it('should show hidden messages indicator when epoch is set', async () => {
    const mockEmbed = { addFields: vi.fn().mockReturnThis() };
    mockCreateInfoEmbed.mockReturnValue(mockEmbed);

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        channelId: 'channel-123',
        personalitySlug: 'lilith',
        personaId: 'persona-123',
        personaName: 'My Profile',
        visible: {
          totalMessages: 7,
          userMessages: 4,
          assistantMessages: 3,
          oldestMessage: '2025-12-10T08:00:00.000Z',
          newestMessage: '2025-12-13T10:30:00.000Z',
        },
        hidden: { count: 3 },
        total: { totalMessages: 10, oldestMessage: '2025-12-01T08:00:00.000Z' },
        contextEpoch: '2025-12-10T08:00:00.000Z',
        canUndo: true,
      },
    });

    const context = createMockContext();
    await handleStats(context);

    expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
      'Conversation Statistics',
      expect.stringContaining('hidden')
    );
  });

  it('should show date range for visible messages', async () => {
    const mockEmbed = { addFields: vi.fn().mockReturnThis() };
    mockCreateInfoEmbed.mockReturnValue(mockEmbed);

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        channelId: 'channel-123',
        personalitySlug: 'lilith',
        personaId: 'persona-123',
        personaName: 'My Profile',
        visible: {
          totalMessages: 10,
          userMessages: 5,
          assistantMessages: 5,
          oldestMessage: '2025-12-10T08:00:00.000Z',
          newestMessage: '2025-12-13T10:30:00.000Z',
        },
        hidden: { count: 0 },
        total: { totalMessages: 10, oldestMessage: '2025-12-10T08:00:00.000Z' },
        contextEpoch: null,
        canUndo: false,
      },
    });

    const context = createMockContext();
    await handleStats(context);

    expect(mockEmbed.addFields).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Visible Messages',
        value: expect.stringContaining('10 messages'),
      }),
      expect.anything(),
      expect.anything()
    );
  });

  it('should show context epoch info when set', async () => {
    const mockEmbed = { addFields: vi.fn().mockReturnThis() };
    mockCreateInfoEmbed.mockReturnValue(mockEmbed);

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        channelId: 'channel-123',
        personalitySlug: 'lilith',
        personaId: 'persona-123',
        personaName: 'My Profile',
        visible: {
          totalMessages: 5,
          userMessages: 3,
          assistantMessages: 2,
          oldestMessage: '2025-12-12T08:00:00.000Z',
          newestMessage: '2025-12-13T10:30:00.000Z',
        },
        hidden: { count: 5 },
        total: { totalMessages: 10, oldestMessage: '2025-12-01T08:00:00.000Z' },
        contextEpoch: '2025-12-12T08:00:00.000Z',
        canUndo: true,
      },
    });

    const context = createMockContext();
    await handleStats(context);

    // Should add Context Cleared At field
    expect(mockEmbed.addFields).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Context Cleared At',
        value: expect.stringContaining('can undo'),
      })
    );
  });

  it('should handle no history (empty stats)', async () => {
    const mockEmbed = { addFields: vi.fn().mockReturnThis() };
    mockCreateInfoEmbed.mockReturnValue(mockEmbed);

    mockCallGatewayApi.mockResolvedValue({
      ok: true,
      data: {
        channelId: 'channel-123',
        personalitySlug: 'lilith',
        personaId: 'persona-123',
        personaName: 'My Profile',
        visible: {
          totalMessages: 0,
          userMessages: 0,
          assistantMessages: 0,
          oldestMessage: null,
          newestMessage: null,
        },
        hidden: { count: 0 },
        total: { totalMessages: 0, oldestMessage: null },
        contextEpoch: null,
        canUndo: false,
      },
    });

    const context = createMockContext();
    await handleStats(context);

    expect(mockEmbed.addFields).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Visible Messages',
        value: expect.stringContaining('0 messages'),
      }),
      expect.anything(),
      expect.anything()
    );
  });

  it('should handle personality not found (404)', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 404,
      error: 'Not found',
    });

    const context = createMockContext('unknown');
    await handleStats(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Personality "unknown" not found.',
    });
  });

  it('should handle generic API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Server error',
    });

    const context = createMockContext();
    await handleStats(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Failed to get stats. Please try again later.',
    });
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const context = createMockContext();
    await handleStats(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });
});
