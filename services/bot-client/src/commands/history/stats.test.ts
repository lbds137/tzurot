/**
 * Tests for History Stats Subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { handleStats } from './stats.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

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

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

// Mock commandHelpers
const mockCreateInfoEmbed = vi.fn(() => ({
  addFields: vi.fn().mockReturnThis(),
}));
vi.mock('../../utils/commandHelpers.js', () => ({
  createInfoEmbed: (...args: unknown[]) =>
    mockCreateInfoEmbed(...(args as Parameters<typeof mockCreateInfoEmbed>)),
}));

interface StubClient {
  getHistoryStats: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return { getHistoryStats: vi.fn() };
}

describe('handleStats', () => {
  let stub: StubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubClient();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(
    personalitySlug: string = 'lilith',
    channelId: string = 'channel-123',
    personaId: string | null = null
  ): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: {
        user: { id: '123456789' },
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'character') return personalitySlug;
            if (name === 'persona') return personaId;
            return null;
          }),
          getBoolean: vi.fn(() => null),
          getInteger: vi.fn(() => null),
        },
      },
      user: { id: '123456789', username: 'testuser' },
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
        if (name === 'character') return personalitySlug;
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
    stub.getHistoryStats.mockResolvedValue(
      makeOk({
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
      })
    );

    const context = createMockContext();
    await handleStats(context);

    expect(stub.getHistoryStats).toHaveBeenCalledWith({
      personalitySlug: 'lilith',
      channelId: 'channel-123',
    });
    expect(mockCreateInfoEmbed).toHaveBeenCalledWith(
      'Conversation Statistics',
      expect.stringContaining('lilith')
    );
    expect(context.editReply).toHaveBeenCalledWith({ embeds: [expect.any(Object)] });
  });

  it('should pass personaId when provided', async () => {
    stub.getHistoryStats.mockResolvedValue(
      makeOk({
        channelId: 'channel-123',
        personalitySlug: 'lilith',
        personaId: 'persona-xyz',
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
      })
    );

    const context = createMockContext('lilith', 'channel-123', 'persona-xyz');
    await handleStats(context);

    expect(stub.getHistoryStats).toHaveBeenCalledWith({
      personalitySlug: 'lilith',
      channelId: 'channel-123',
      personaId: 'persona-xyz',
    });
  });

  it('should show hidden messages indicator when epoch is set', async () => {
    const mockEmbed = { addFields: vi.fn().mockReturnThis() };
    mockCreateInfoEmbed.mockReturnValue(mockEmbed);

    stub.getHistoryStats.mockResolvedValue(
      makeOk({
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
      })
    );

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

    stub.getHistoryStats.mockResolvedValue(
      makeOk({
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
      })
    );

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

    stub.getHistoryStats.mockResolvedValue(
      makeOk({
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
      })
    );

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

    stub.getHistoryStats.mockResolvedValue(
      makeOk({
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
      })
    );

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
    stub.getHistoryStats.mockResolvedValue(makeErr(404, 'Not found'));

    const context = createMockContext('unknown');
    await handleStats(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Character "unknown" not found.',
    });
  });

  it('should handle generic API error', async () => {
    stub.getHistoryStats.mockResolvedValue(makeErr(500, 'Server error'));

    const context = createMockContext();
    await handleStats(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Server error',
    });
  });

  it('should handle exceptions', async () => {
    stub.getHistoryStats.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleStats(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Failed to load the history stats. Please try again.',
    });
  });

  it('rejects the autocomplete-error sentinel in personalitySlug before calling the gateway', async () => {
    const context = createMockContext('__autocomplete_error__');
    await handleStats(context);

    expect(stub.getHistoryStats).not.toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
    });
  });

  it('rejects the autocomplete-error sentinel in personaId before calling the gateway', async () => {
    const context = createMockContext('lilith', 'channel-123', '__autocomplete_error__');
    await handleStats(context);

    expect(stub.getHistoryStats).not.toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
    });
  });
});
