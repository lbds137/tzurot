/**
 * Tests for History Stats Subcommand
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
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
const mockReplyWithError = vi.fn();
const mockHandleCommandError = vi.fn();
const mockCreateInfoEmbed = vi.fn(() => ({
  addFields: vi.fn().mockReturnThis(),
}));
vi.mock('../../utils/commandHelpers.js', () => ({
  replyWithError: (...args: unknown[]) => mockReplyWithError(...args),
  handleCommandError: (...args: unknown[]) => mockHandleCommandError(...args),
  createInfoEmbed: (...args: unknown[]) => mockCreateInfoEmbed(...args),
}));

describe('handleStats', () => {
  const mockEditReply = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function createMockInteraction(
    personalitySlug: string = 'lilith',
    channelId: string = 'channel-123'
  ) {
    return {
      user: { id: '123456789' },
      channelId,
      options: {
        getString: (name: string, _required?: boolean) => {
          if (name === 'personality') return personalitySlug;
          return null;
        },
      },
      editReply: mockEditReply,
    } as unknown as Parameters<typeof handleStats>[0];
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

    const interaction = createMockInteraction();
    await handleStats(interaction);

    expect(mockCallGatewayApi).toHaveBeenCalledWith(
      '/user/history/stats?personalitySlug=lilith&channelId=channel-123',
      { userId: '123456789', method: 'GET' }
    );
    expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
      'Conversation Statistics',
      expect.stringContaining('lilith')
    );
    expect(mockEditReply).toHaveBeenCalledWith({ embeds: [expect.any(Object)] });
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

    const interaction = createMockInteraction();
    await handleStats(interaction);

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

    const interaction = createMockInteraction();
    await handleStats(interaction);

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

    const interaction = createMockInteraction();
    await handleStats(interaction);

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

    const interaction = createMockInteraction();
    await handleStats(interaction);

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

    const interaction = createMockInteraction('unknown');
    await handleStats(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      'Personality "unknown" not found.'
    );
  });

  it('should handle generic API error', async () => {
    mockCallGatewayApi.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'Server error',
    });

    const interaction = createMockInteraction();
    await handleStats(interaction);

    expect(mockReplyWithError).toHaveBeenCalledWith(
      interaction,
      'Failed to get stats. Please try again later.'
    );
  });

  it('should handle exceptions', async () => {
    const error = new Error('Network error');
    mockCallGatewayApi.mockRejectedValue(error);

    const interaction = createMockInteraction();
    await handleStats(interaction);

    expect(mockHandleCommandError).toHaveBeenCalledWith(interaction, error, {
      userId: '123456789',
      command: 'History Stats',
    });
  });
});
