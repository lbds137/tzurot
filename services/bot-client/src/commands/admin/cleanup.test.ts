/**
 * Tests for Admin Cleanup Subcommand Handler
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeErr } from '../../test/gatewayClientStubs.js';
import type { GatewayResult, OwnerClient } from '@tzurot/clients';
import { handleCleanup } from './cleanup.js';
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
  cleanup: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return { cleanup: vi.fn() };
}

function asOwnerClient(stub: StubClient): OwnerClient {
  return stub as unknown as OwnerClient;
}

function ok<T>(data: T): GatewayResult<T> {
  return { ok: true, data };
}

function createMockCleanupResponse(
  overrides: Partial<{
    success: boolean;
    historyDeleted: number;
    tombstonesDeleted: number;
    daysKept: number;
    message: string;
    timestamp: string;
  }> = {}
) {
  return {
    success: true,
    historyDeleted: 10,
    tombstonesDeleted: 5,
    daysKept: 30,
    message: 'Cleanup complete: 10 history messages and 5 tombstones deleted (older than 30 days)',
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

describe('handleCleanup', () => {
  let stub: StubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubClient();
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockContext(
    days: number | null = null,
    target: string | null = null
  ): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);
    return {
      interaction: {
        user: { id: 'user-123' },
        options: {
          getString: vi.fn((name: string) => {
            if (name === 'target') return target;
            return null;
          }),
          getBoolean: vi.fn(() => null),
          getInteger: vi.fn((name: string) => {
            if (name === 'days') return days;
            return null;
          }),
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
        if (name === 'days') return days;
        if (name === 'target') return target;
        return null;
      }),
      getRequiredOption: vi.fn(),
      getSubcommand: () => 'cleanup',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  it('should use default daysToKeep of 30 when not provided', async () => {
    stub.cleanup.mockResolvedValue(ok(createMockCleanupResponse()));

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(stub.cleanup).toHaveBeenCalledWith(
      expect.objectContaining({ daysToKeep: 30, target: 'all' })
    );
  });

  it('should use provided daysToKeep value', async () => {
    stub.cleanup.mockResolvedValue(ok(createMockCleanupResponse({ daysKept: 7 })));

    const context = createMockContext(7, null);
    await handleCleanup(context);

    expect(stub.cleanup).toHaveBeenCalledWith(
      expect.objectContaining({ daysToKeep: 7, target: 'all' })
    );
  });

  it('should use default target of "all" when not provided', async () => {
    stub.cleanup.mockResolvedValue(ok(createMockCleanupResponse()));

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(stub.cleanup).toHaveBeenCalledWith(expect.objectContaining({ target: 'all' }));
  });

  it('should use provided target value', async () => {
    stub.cleanup.mockResolvedValue(ok(createMockCleanupResponse({ tombstonesDeleted: 0 })));

    const context = createMockContext(null, 'history');
    await handleCleanup(context);

    expect(stub.cleanup).toHaveBeenCalledWith(expect.objectContaining({ target: 'history' }));
  });

  it('should display success message with cleanup results', async () => {
    stub.cleanup.mockResolvedValue(
      ok(createMockCleanupResponse({ historyDeleted: 25, tombstonesDeleted: 10 }))
    );

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('✅ **Cleanup Complete**'),
    });
  });

  it('should handle HTTP errors', async () => {
    stub.cleanup.mockResolvedValue(makeErr(500, 'Internal Server Error'));

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Cleanup failed'),
    });
  });

  it('should handle network errors', async () => {
    stub.cleanup.mockRejectedValue(new Error('Network error'));

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Failed to run cleanup'),
    });
  });

  it('should handle zero deletions', async () => {
    stub.cleanup.mockResolvedValue(
      ok(createMockCleanupResponse({ historyDeleted: 0, tombstonesDeleted: 0 }))
    );

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('✅ **Cleanup Complete**'),
    });
  });

  it('should handle 403 unauthorized response', async () => {
    stub.cleanup.mockResolvedValue(makeErr(403, 'Unauthorized'));

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Cleanup failed'),
    });
  });

  it('should display daysKept in the response', async () => {
    stub.cleanup.mockResolvedValue(ok(createMockCleanupResponse({ daysKept: 60 })));

    const context = createMockContext(60, null);
    await handleCleanup(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('60'),
    });
  });
});
