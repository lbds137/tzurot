/**
 * Tests for History Undo Subcommand
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { handleUndo } from './undo.js';
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
const mockCreateSuccessEmbed = vi.fn(() => ({}));
vi.mock('../../utils/commandHelpers.js', () => ({
  createSuccessEmbed: (...args: unknown[]) =>
    mockCreateSuccessEmbed(...(args as Parameters<typeof mockCreateSuccessEmbed>)),
}));

interface StubClient {
  undoHistory: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return { undoHistory: vi.fn() };
}

describe('handleUndo', () => {
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
      getSubcommand: () => 'undo',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  it('should undo clear successfully', async () => {
    stub.undoHistory.mockResolvedValue(
      makeOk({
        success: true,
        restoredEpoch: '2025-12-12T08:00:00.000Z',
        message: 'Context restored',
      })
    );

    const context = createMockContext();
    await handleUndo(context);

    expect(stub.undoHistory).toHaveBeenCalledWith({ personalitySlug: 'lilith' });
    expect(mockCreateSuccessEmbed).toHaveBeenCalledWith(
      'Context Restored',
      expect.stringContaining('lilith')
    );
    expect(context.editReply).toHaveBeenCalledWith({ embeds: [expect.any(Object)] });
  });

  it('should pass personaId when provided', async () => {
    stub.undoHistory.mockResolvedValue(
      makeOk({
        success: true,
        restoredEpoch: '2025-12-12T08:00:00.000Z',
        message: 'Context restored',
      })
    );

    const context = createMockContext('lilith', 'persona-xyz');
    await handleUndo(context);

    expect(stub.undoHistory).toHaveBeenCalledWith({
      personalitySlug: 'lilith',
      personaId: 'persona-xyz',
    });
  });

  it('should handle personality not found (404)', async () => {
    stub.undoHistory.mockResolvedValue(makeErr(404, 'Not found'));

    const context = createMockContext('unknown');
    await handleUndo(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Character "unknown" not found.',
    });
  });

  it('should handle no previous context (400)', async () => {
    stub.undoHistory.mockResolvedValue(makeErr(400, 'No previous context'));

    const context = createMockContext();
    await handleUndo(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ No previous context to restore. Undo is only available after a clear operation.',
    });
  });

  it('should handle generic API error', async () => {
    stub.undoHistory.mockResolvedValue(makeErr(500, 'Server error'));

    const context = createMockContext();
    await handleUndo(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ Failed to undo. Please try again later.',
    });
  });

  it('should handle exceptions', async () => {
    stub.undoHistory.mockRejectedValue(new Error('Network error'));

    const context = createMockContext();
    await handleUndo(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: '❌ An error occurred. Please try again later.',
    });
  });

  it('rejects the autocomplete-error sentinel in personalitySlug before calling the gateway', async () => {
    const context = createMockContext('__autocomplete_error__');
    await handleUndo(context);

    expect(stub.undoHistory).not.toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
    });
  });

  it('rejects the autocomplete-error sentinel in personaId before calling the gateway', async () => {
    const context = createMockContext('lilith', '__autocomplete_error__');
    await handleUndo(context);

    expect(stub.undoHistory).not.toHaveBeenCalled();
    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('Autocomplete was unavailable'),
    });
  });
});
