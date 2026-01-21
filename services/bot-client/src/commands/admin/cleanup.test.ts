/**
 * Tests for Admin Cleanup Subcommand Handler
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleCleanup } from './cleanup.js';
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
 * Create mock cleanup response
 */
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
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(
    days: number | null = null,
    target: string | null = null
  ): DeferredCommandContext {
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
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockCleanupResponse()), { status: 200 })
    );

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/cleanup'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"daysToKeep":30'),
      })
    );
  });

  it('should use provided daysToKeep value', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockCleanupResponse({ daysKept: 7 })), { status: 200 })
    );

    const context = createMockContext(7, null);
    await handleCleanup(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/cleanup'),
      expect.objectContaining({
        body: expect.stringContaining('"daysToKeep":7'),
      })
    );
  });

  it('should use default target of "all" when not provided', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockCleanupResponse()), { status: 200 })
    );

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/cleanup'),
      expect.objectContaining({
        body: expect.stringContaining('"target":"all"'),
      })
    );
  });

  it('should use provided target value', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockCleanupResponse({ tombstonesDeleted: 0 })), {
        status: 200,
      })
    );

    const context = createMockContext(null, 'history');
    await handleCleanup(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/cleanup'),
      expect.objectContaining({
        body: expect.stringContaining('"target":"history"'),
      })
    );
  });

  it('should include service secret in headers', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockCleanupResponse()), { status: 200 })
    );

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({
          'X-Service-Auth': 'test-service-secret',
        }),
      })
    );
  });

  it('should display success message with cleanup results', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify(createMockCleanupResponse({ historyDeleted: 25, tombstonesDeleted: 10 })),
        { status: 200 }
      )
    );

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('✅ **Cleanup Complete**'),
    });
  });

  it('should handle HTTP errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Cleanup failed'),
    });
  });

  it('should handle network errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Error running cleanup'),
    });
  });

  it('should handle zero deletions', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify(createMockCleanupResponse({ historyDeleted: 0, tombstonesDeleted: 0 })),
        { status: 200 }
      )
    );

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('✅ **Cleanup Complete**'),
    });
  });

  it('should handle 403 unauthorized response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Unauthorized', { status: 403 }));

    const context = createMockContext(null, null);
    await handleCleanup(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Cleanup failed'),
    });
  });

  it('should display daysKept in the response', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockCleanupResponse({ daysKept: 60 })), { status: 200 })
    );

    const context = createMockContext(60, null);
    await handleCleanup(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('60'),
    });
  });
});
