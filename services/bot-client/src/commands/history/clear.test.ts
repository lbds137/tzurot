/**
 * Tests for History Clear Subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { handleClear } from './clear.js';
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
const mockCreateSuccessEmbed = vi.fn(() => ({
  addFields: vi.fn().mockReturnThis(),
}));
vi.mock('../../utils/commandHelpers.js', () => ({
  createSuccessEmbed: (...args: unknown[]) =>
    mockCreateSuccessEmbed(...(args as Parameters<typeof mockCreateSuccessEmbed>)),
}));

interface StubClient {
  clearHistory: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return { clearHistory: vi.fn() };
}

describe('handleClear', () => {
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
      channelId: '111111111111111111',
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
      getSubcommand: () => 'clear',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  it('should clear history successfully', async () => {
    stub.clearHistory.mockResolvedValue(
      makeOk({
        success: true,
        epoch: '2025-12-13T10:30:00.000Z',
        canUndo: false,
        message: 'Context cleared',
      })
    );

    const context = createMockContext();
    await handleClear(context);

    expect(stub.clearHistory).toHaveBeenCalledWith({ personalitySlug: 'lilith' });
    expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
      'Context Cleared',
      expect.stringContaining('lilith')
    );
    expect(context.editReply).toHaveBeenCalledWith({ embeds: [expect.any(Object)] });
  });

  it('should pass personaId when provided', async () => {
    stub.clearHistory.mockResolvedValue(
      makeOk({
        success: true,
        epoch: '2025-12-13T10:30:00.000Z',
        canUndo: false,
        message: 'Context cleared',
      })
    );

    const context = createMockContext('lilith', 'persona-xyz');
    await handleClear(context);

    expect(stub.clearHistory).toHaveBeenCalledWith({
      personalitySlug: 'lilith',
      personaId: 'persona-xyz',
    });
  });

  it('should show undo available when canUndo is true', async () => {
    const mockEmbed = { addFields: vi.fn().mockReturnThis() };
    mockCreateSuccessEmbed.mockReturnValue(mockEmbed);

    stub.clearHistory.mockResolvedValue(
      makeOk({
        success: true,
        epoch: '2025-12-13T10:30:00.000Z',
        canUndo: true,
        message: 'Context cleared',
      })
    );

    const context = createMockContext();
    await handleClear(context);

    expect(mockEmbed.addFields).toHaveBeenCalledWith({
      name: 'Undo Available',
      value: expect.stringContaining('/history undo'),
      inline: false,
    });
  });

  it('should show first clear message when canUndo is false', async () => {
    const mockEmbed = { addFields: vi.fn().mockReturnThis() };
    mockCreateSuccessEmbed.mockReturnValue(mockEmbed);

    stub.clearHistory.mockResolvedValue(
      makeOk({
        success: true,
        epoch: '2025-12-13T10:30:00.000Z',
        canUndo: false,
        message: 'Context cleared',
      })
    );

    const context = createMockContext();
    await handleClear(context);

    expect(mockEmbed.addFields).toHaveBeenCalledWith({
      name: 'Undo Available',
      value: expect.stringContaining('first clear'),
      inline: false,
    });
  });

  it('should handle personality not found (404)', async () => {
    stub.clearHistory.mockResolvedValue(makeErr(404, 'Not found'));

    const context = createMockContext('unknown');
    await handleClear(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Character "unknown" not found.',
    });
  });

  it('should handle generic API error', async () => {
    stub.clearHistory.mockResolvedValue(makeErr(500, 'Server error'));

    const context = createMockContext();
    await handleClear(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Failed to clear history. Please try again later.',
    });
  });

  it('should handle exceptions', async () => {
    stub.clearHistory.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleClear(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });

  it('rejects the autocomplete-error sentinel in personalitySlug before calling the gateway', async () => {
    const context = createMockContext('__autocomplete_error__');
    await handleClear(context);

    expect(stub.clearHistory).not.toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
    });
  });

  it('rejects the autocomplete-error sentinel in personaId before calling the gateway', async () => {
    const context = createMockContext('lilith', '__autocomplete_error__');
    await handleClear(context);

    expect(stub.clearHistory).not.toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
    });
  });
});
