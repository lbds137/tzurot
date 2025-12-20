/**
 * Tests for Admin Cleanup Subcommand Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleCleanup } from './cleanup.js';
import type { ChatInputCommandInteraction, User } from 'discord.js';

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
  let mockInteraction: ChatInputCommandInteraction;
  let mockUser: User;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUser = {
      id: 'user-123',
    } as User;

    mockInteraction = {
      user: mockUser,
      options: {
        getInteger: vi.fn(),
        getString: vi.fn(),
      },
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Note: deferReply is handled by top-level interactionCreate handler

  it('should use default daysToKeep of 30 when not provided', async () => {
    vi.mocked(mockInteraction.options.getInteger).mockReturnValue(null);
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockCleanupResponse()), { status: 200 })
    );

    await handleCleanup(mockInteraction);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/cleanup'),
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"daysToKeep":30'),
      })
    );
  });

  it('should use provided daysToKeep value', async () => {
    vi.mocked(mockInteraction.options.getInteger).mockReturnValue(7);
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockCleanupResponse({ daysKept: 7 })), { status: 200 })
    );

    await handleCleanup(mockInteraction);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/cleanup'),
      expect.objectContaining({
        body: expect.stringContaining('"daysToKeep":7'),
      })
    );
  });

  it('should use default target of "all" when not provided', async () => {
    vi.mocked(mockInteraction.options.getInteger).mockReturnValue(null);
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockCleanupResponse()), { status: 200 })
    );

    await handleCleanup(mockInteraction);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/cleanup'),
      expect.objectContaining({
        body: expect.stringContaining('"target":"all"'),
      })
    );
  });

  it('should use provided target value', async () => {
    vi.mocked(mockInteraction.options.getInteger).mockReturnValue(null);
    vi.mocked(mockInteraction.options.getString).mockReturnValue('history');
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockCleanupResponse({ tombstonesDeleted: 0 })), {
        status: 200,
      })
    );

    await handleCleanup(mockInteraction);

    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/admin/cleanup'),
      expect.objectContaining({
        body: expect.stringContaining('"target":"history"'),
      })
    );
  });

  it('should include service secret in headers', async () => {
    vi.mocked(mockInteraction.options.getInteger).mockReturnValue(null);
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockCleanupResponse()), { status: 200 })
    );

    await handleCleanup(mockInteraction);

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
    vi.mocked(mockInteraction.options.getInteger).mockReturnValue(null);
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify(createMockCleanupResponse({ historyDeleted: 25, tombstonesDeleted: 10 })),
        { status: 200 }
      )
    );

    await handleCleanup(mockInteraction);

    const editReplyCall = mockInteraction.editReply as ReturnType<typeof vi.fn>;
    const message = editReplyCall.mock.calls[0][0] as string;

    expect(message).toContain('✅ **Cleanup Complete**');
    expect(message).toContain('History messages deleted: **25**');
    expect(message).toContain('Tombstones deleted: **10**');
  });

  it('should handle HTTP errors', async () => {
    vi.mocked(mockInteraction.options.getInteger).mockReturnValue(null);
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(new Response('Internal Server Error', { status: 500 }));

    await handleCleanup(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Cleanup failed')
    );
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
  });

  it('should handle network errors', async () => {
    vi.mocked(mockInteraction.options.getInteger).mockReturnValue(null);
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockRejectedValue(new Error('Network error'));

    await handleCleanup(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Error running cleanup')
    );
  });

  it('should handle zero deletions', async () => {
    vi.mocked(mockInteraction.options.getInteger).mockReturnValue(null);
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify(createMockCleanupResponse({ historyDeleted: 0, tombstonesDeleted: 0 })),
        { status: 200 }
      )
    );

    await handleCleanup(mockInteraction);

    const editReplyCall = mockInteraction.editReply as ReturnType<typeof vi.fn>;
    const message = editReplyCall.mock.calls[0][0] as string;

    expect(message).toContain('✅ **Cleanup Complete**');
    expect(message).toContain('History messages deleted: **0**');
    expect(message).toContain('Tombstones deleted: **0**');
  });

  it('should handle 403 unauthorized response', async () => {
    vi.mocked(mockInteraction.options.getInteger).mockReturnValue(null);
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(new Response('Unauthorized', { status: 403 }));

    await handleCleanup(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Cleanup failed')
    );
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'));
  });

  it('should display daysKept in the response', async () => {
    vi.mocked(mockInteraction.options.getInteger).mockReturnValue(60);
    vi.mocked(mockInteraction.options.getString).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify(createMockCleanupResponse({ daysKept: 60 })), { status: 200 })
    );

    await handleCleanup(mockInteraction);

    const editReplyCall = mockInteraction.editReply as ReturnType<typeof vi.fn>;
    const message = editReplyCall.mock.calls[0][0] as string;

    expect(message).toContain('Kept messages from last: **60** days');
  });
});
