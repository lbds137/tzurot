/**
 * Tests for Admin DB Sync Subcommand Handler
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleDbSync } from './db-sync.js';
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
