/**
 * Tests for Admin DB Sync Subcommand Handler
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleDbSync, formatListForEmbedField } from './db-sync.js';
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

describe('handleDbSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Create a mock DeferredCommandContext for testing.
   */
  function createMockContext(dryRun: boolean | null = null): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);

    return {
      interaction: {
        options: {
          getString: vi.fn(() => null),
          getBoolean: vi.fn((name: string) => {
            if (name === 'dry-run') return dryRun;
            return null;
          }),
          getInteger: vi.fn(() => null),
        },
      },
      user: { id: 'owner-123' },
      guild: null,
      member: null,
      channel: null,
      channelId: 'channel-123',
      guildId: null,
      commandName: 'admin',
      isEphemeral: true,
      getOption: vi.fn((name: string) => {
        if (name === 'dry-run') return dryRun;
        return null;
      }),
      getRequiredOption: vi.fn(),
      getSubcommand: () => 'db-sync',
      getSubcommandGroup: () => null,
      editReply: mockEditReply,
      followUp: vi.fn(),
      deleteReply: vi.fn(),
    } as unknown as DeferredCommandContext;
  }

  it('should default dry-run to false when not provided', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: '1.0' }), { status: 200 })
    );

    const context = createMockContext(null);
    await handleDbSync(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"dryRun":false'),
      })
    );
  });

  it('should use provided dry-run value', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: '1.0' }), { status: 200 })
    );

    const context = createMockContext(true);
    await handleDbSync(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"dryRun":true'),
      })
    );
  });

  it('should include owner ID in request body', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: '1.0' }), { status: 200 })
    );

    const context = createMockContext(false);
    await handleDbSync(context);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"ownerId":"owner-123"'),
      })
    );
  });

  it('should use POST method with correct headers including service secret', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: '1.0' }), { status: 200 })
    );

    const context = createMockContext(false);
    await handleDbSync(context);

    expect(fetch).toHaveBeenCalledWith(
      'http://localhost:3000/admin/db-sync',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Service-Auth': 'test-service-secret',
        }),
      })
    );
  });

  it('should display success embed for dry run', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: '1.0.0',
          stats: {
            users: { devToProd: 5, prodToDev: 2, conflicts: 0 },
          },
        }),
        { status: 200 }
      )
    );

    const context = createMockContext(true);
    await handleDbSync(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should display success embed for actual sync', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: '1.0.0',
          stats: {
            users: { devToProd: 5, prodToDev: 2, conflicts: 0 },
          },
        }),
        { status: 200 }
      )
    );

    const context = createMockContext(false);
    await handleDbSync(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should display sync statistics', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: '2.0.0',
          stats: {
            users: { devToProd: 10, prodToDev: 5, conflicts: 1 },
            personas: { devToProd: 3, prodToDev: 0, conflicts: 0 },
          },
        }),
        { status: 200 }
      )
    );

    const context = createMockContext(false);
    await handleDbSync(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should display warnings when present', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: '1.0.0',
          stats: {},
          warnings: ['⚠️ Table mismatch detected', '⚠️ Schema version mismatch'],
        }),
        { status: 200 }
      )
    );

    const context = createMockContext(false);
    await handleDbSync(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle HTTP errors', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Database not configured', { status: 500 }));

    const context = createMockContext(false);
    await handleDbSync(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Database sync failed'),
    });
  });

  it('should handle network errors', async () => {
    vi.mocked(fetch).mockRejectedValue(new Error('Network timeout'));

    const context = createMockContext(false);
    await handleDbSync(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Error during database sync'),
    });
  });

  it('should handle changes preview in dry run', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: '1.0.0',
          stats: {},
          changes: {
            users: [{ id: '1', action: 'insert' }],
          },
        }),
        { status: 200 }
      )
    );

    const context = createMockContext(true);
    await handleDbSync(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle empty stats gracefully', async () => {
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: '1.0.0',
        }),
        { status: 200 }
      )
    );

    const context = createMockContext(false);
    await handleDbSync(context);

    expect(context.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle 403 unauthorized response', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('Forbidden', { status: 403 }));

    const context = createMockContext(false);
    await handleDbSync(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Database sync failed'),
    });
  });
});

describe('formatListForEmbedField', () => {
  // Discord's embed-field hard cap; matches `TEXT_LIMITS.DISCORD_EMBED_FIELD`.
  const FIELD_LIMIT = 1024;

  it('returns empty string for an empty list', () => {
    expect(formatListForEmbedField([], FIELD_LIMIT)).toBe('');
  });

  it('joins items with newlines when the result fits in the limit', () => {
    const items = ['users', 'posts', 'comments'];
    expect(formatListForEmbedField(items, FIELD_LIMIT)).toBe('users\nposts\ncomments');
  });

  it('preserves whole items at the cut, never slicing mid-string', () => {
    // Construct a list that would overflow a naive `.join('\n').slice(0, limit)`.
    // Each entry is 50 chars; with newlines that's 51 per row. At limit=255
    // (~5 rows + change), naive slicing would chop the 6th entry mid-string.
    const items = Array.from({ length: 12 }, (_, i) =>
      `table-name-${String(i).padStart(3, '0')}-`.padEnd(50, 'x')
    );
    const result = formatListForEmbedField(items, 255);

    // No surviving line should be a prefix-only fragment of an original item.
    const lines = result.split('\n');
    const trailingSuffix = lines[lines.length - 1];
    expect(trailingSuffix).toMatch(/^…and \d+ more$/);
    for (const survivor of lines.slice(0, -1)) {
      expect(items).toContain(survivor);
    }
    expect(result.length).toBeLessThanOrEqual(255);
  });

  it('appends a "…and N more" suffix counting omitted items', () => {
    const items = ['short-1', 'short-2', 'short-3', 'short-4', 'short-5'];
    // 5 items × 7 chars + 4 newlines = 39, doesn't fit in 30. The helper
    // sizes its suffix reservation against the worst case (all items
    // omitted → "\n…and 5 more" = 12 chars; `…` is U+2026, a single code
    // point), so the survivor budget is 30 − 12 = 18 chars. That fits
    // "short-1" + "\n" + "short-2" = 15 chars; "short-3" at +1+7=23 exceeds
    // 18 and is dropped. The conservative sizing means we omit one more
    // item than strictly necessary in the suffix-shrinks-as-omitted-grows
    // case — accepted trade-off for predictable per-call sizing.
    const result = formatListForEmbedField(items, 30);
    expect(result).toBe('short-1\nshort-2\n…and 3 more');
    expect(result.length).toBeLessThanOrEqual(30);
  });

  it('produces just the suffix when no single item fits', () => {
    // The first item alone exceeds the survivor budget — fall back to a
    // pure suffix rather than dropping the suffix and slicing.
    const huge = 'x'.repeat(2000);
    const result = formatListForEmbedField([huge, 'small'], 50);
    expect(result).toBe('…and 2 more');
  });

  it('handles a single oversized item by emitting only the suffix', () => {
    expect(formatListForEmbedField(['x'.repeat(2000)], 50)).toBe('…and 1 more');
  });

  it('returns the joined result intact when it equals the limit exactly', () => {
    const items = ['a', 'b', 'c']; // 'a\nb\nc' = 5 chars
    expect(formatListForEmbedField(items, 5)).toBe('a\nb\nc');
  });
});
