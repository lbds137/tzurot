/**
 * Tests for Admin DB Sync Subcommand Handler
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleDbSync } from './db-sync.js';
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

describe('handleDbSync', () => {
  let mockInteraction: ChatInputCommandInteraction;
  let mockUser: User;

  beforeEach(() => {
    vi.clearAllMocks();

    mockUser = {
      id: 'owner-123',
    } as User;

    mockInteraction = {
      user: mockUser,
      options: {
        getBoolean: vi.fn(),
      },
      editReply: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Note: deferReply is handled by top-level interactionCreate handler

  it('should default dry-run to false when not provided', async () => {
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(null);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: '1.0' }), { status: 200 })
    );

    await handleDbSync(mockInteraction);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"dryRun":false'),
      })
    );
  });

  it('should use provided dry-run value', async () => {
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(true);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: '1.0' }), { status: 200 })
    );

    await handleDbSync(mockInteraction);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"dryRun":true'),
      })
    );
  });

  it('should include owner ID in request body', async () => {
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(false);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: '1.0' }), { status: 200 })
    );

    await handleDbSync(mockInteraction);

    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"ownerId":"owner-123"'),
      })
    );
  });

  it('should use POST method with correct headers including service secret', async () => {
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(false);
    vi.mocked(fetch).mockResolvedValue(
      new Response(JSON.stringify({ schemaVersion: '1.0' }), { status: 200 })
    );

    await handleDbSync(mockInteraction);

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
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(true);
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

    await handleDbSync(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should display success embed for actual sync', async () => {
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(false);
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

    await handleDbSync(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should display sync statistics', async () => {
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(false);
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

    await handleDbSync(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should display warnings when present', async () => {
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(false);
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

    await handleDbSync(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle HTTP errors', async () => {
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(false);
    vi.mocked(fetch).mockResolvedValue(new Response('Database not configured', { status: 500 }));

    await handleDbSync(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Database sync failed')
    );
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('HTTP 500'));
  });

  it('should handle network errors', async () => {
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(false);
    vi.mocked(fetch).mockRejectedValue(new Error('Network timeout'));

    await handleDbSync(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Error during database sync')
    );
  });

  it('should handle changes preview in dry run', async () => {
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(true);
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

    await handleDbSync(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle empty stats gracefully', async () => {
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(false);
    vi.mocked(fetch).mockResolvedValue(
      new Response(
        JSON.stringify({
          schemaVersion: '1.0.0',
        }),
        { status: 200 }
      )
    );

    await handleDbSync(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith({
      embeds: [expect.any(Object)],
    });
  });

  it('should handle 403 unauthorized response', async () => {
    vi.mocked(mockInteraction.options.getBoolean).mockReturnValue(false);
    vi.mocked(fetch).mockResolvedValue(new Response('Forbidden', { status: 403 }));

    await handleDbSync(mockInteraction);

    expect(mockInteraction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('❌ Database sync failed')
    );
    expect(mockInteraction.editReply).toHaveBeenCalledWith(expect.stringContaining('HTTP 403'));
  });
});
