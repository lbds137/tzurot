/**
 * Tests for Admin DB Sync Subcommand Handler
 *
 * This handler receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeErr } from '../../test/gatewayClientStubs.js';
import type { GatewayResult, OwnerClient } from '@tzurot/clients';
import { handleDbSync, buildSyncSummary, buildSyncReportMarkdown } from './db-sync.js';
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
  dbSync: ReturnType<typeof vi.fn>;
}

function createStubClient(): StubClient {
  return { dbSync: vi.fn() };
}

function asOwnerClient(stub: StubClient): OwnerClient {
  return stub as unknown as OwnerClient;
}

function ok<T>(data: T): GatewayResult<T> {
  return { ok: true, data };
}

describe('handleDbSync', () => {
  let stub: StubClient;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStubClient();
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockContext(dryRun: boolean | null = null): DeferredCommandContext {
    const mockEditReply = vi.fn().mockResolvedValue(undefined);
    return {
      interaction: {
        user: { id: 'owner-123' },
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

  /** The first editReply call's payload, typed loosely for inspection. */
  function replyPayload(context: DeferredCommandContext): {
    embeds?: { data: { description?: string; title?: string } }[];
    files?: unknown[];
  } {
    return vi.mocked(context.editReply).mock.calls[0][0] as never;
  }

  it('should default dry-run to false when not provided', async () => {
    stub.dbSync.mockResolvedValue(ok({ success: true, timestamp: 'now', schemaVersion: '1.0' }));

    const context = createMockContext(null);
    await handleDbSync(context);

    expect(stub.dbSync).toHaveBeenCalledWith({ dryRun: false, allowSchemaSkew: false });
  });

  it('should use provided dry-run value', async () => {
    stub.dbSync.mockResolvedValue(ok({ success: true, timestamp: 'now', schemaVersion: '1.0' }));

    const context = createMockContext(true);
    await handleDbSync(context);

    expect(stub.dbSync).toHaveBeenCalledWith({ dryRun: true, allowSchemaSkew: false });
  });

  it('replies with a summary embed AND an attached report file', async () => {
    stub.dbSync.mockResolvedValue(
      ok({
        success: true,
        timestamp: 'now',
        schemaVersion: '1.0.0',
        stats: { users: { devToProd: 5, prodToDev: 2, conflicts: 0, deleted: 0 } },
      })
    );

    const context = createMockContext(false);
    await handleDbSync(context);

    const payload = replyPayload(context);
    expect(payload.embeds).toHaveLength(1);
    expect(payload.files).toHaveLength(1);
    expect(payload.embeds?.[0].data.title).toContain('Database Sync Complete');
  });

  it('uses the dry-run title and warning framing on dry runs', async () => {
    stub.dbSync.mockResolvedValue(
      ok({
        success: true,
        timestamp: 'now',
        schemaVersion: '1.0.0',
        stats: { users: { devToProd: 5, prodToDev: 2, conflicts: 0, deleted: 0 } },
      })
    );

    const context = createMockContext(true);
    await handleDbSync(context);

    const payload = replyPayload(context);
    expect(payload.embeds?.[0].data.title).toContain('Dry Run');
    expect(payload.embeds?.[0].data.description).toContain('Dry run — no changes were applied');
    expect(payload.files).toHaveLength(1);
  });

  it('summarizes totals and shows only tables with activity', async () => {
    stub.dbSync.mockResolvedValue(
      ok({
        success: true,
        timestamp: 'now',
        schemaVersion: '2.0.0',
        stats: {
          users: { devToProd: 10, prodToDev: 5, conflicts: 1, deleted: 0 },
          personas: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 },
        },
      })
    );

    const context = createMockContext(false);
    await handleDbSync(context);

    const description = replyPayload(context).embeds?.[0].data.description ?? '';
    expect(description).toContain(
      '**2 tables** · 10 dev→prod · 5 prod→dev · 1 conflicts · 0 deleted'
    );
    expect(description).toContain('`users`:');
    // Quiet tables stay out of the embed — they live in the report file.
    expect(description).not.toContain('`personas`:');
  });

  it('surfaces the warning COUNT in the embed (full list lives in the report)', async () => {
    stub.dbSync.mockResolvedValue(
      ok({
        success: true,
        timestamp: 'now',
        schemaVersion: '1.0.0',
        stats: {},
        warnings: ['Table mismatch detected', 'Schema version mismatch'],
      })
    );

    const context = createMockContext(false);
    await handleDbSync(context);

    const description = replyPayload(context).embeds?.[0].data.description ?? '';
    expect(description).toContain('⚠️ 2 warning(s) — full list in the attached report');
    // The warning bodies themselves must NOT be in the embed.
    expect(description).not.toContain('Table mismatch detected');
  });

  it('should handle HTTP errors', async () => {
    stub.dbSync.mockResolvedValue(makeErr(500, 'Database not configured'));

    const context = createMockContext(false);
    await handleDbSync(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Database sync failed'),
    });
  });

  it('should handle network errors', async () => {
    stub.dbSync.mockRejectedValue(new Error('Network timeout'));

    const context = createMockContext(false);
    await handleDbSync(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Failed to run the database sync'),
    });
  });

  it('should handle empty stats gracefully', async () => {
    stub.dbSync.mockResolvedValue(ok({ success: true, timestamp: 'now', schemaVersion: '1.0.0' }));

    const context = createMockContext(false);
    await handleDbSync(context);

    const payload = replyPayload(context);
    expect(payload.embeds).toHaveLength(1);
    expect(payload.files).toHaveLength(1);
  });

  it('should handle 403 unauthorized response', async () => {
    stub.dbSync.mockResolvedValue(makeErr(403, 'Forbidden'));

    const context = createMockContext(false);
    await handleDbSync(context);

    expect(context.editReply).toHaveBeenCalledWith({
      content: expect.stringContaining('❌ Database sync failed'),
    });
  });
});

describe('buildSyncSummary', () => {
  it('reports the in-sync state when no table has activity', () => {
    const summary = buildSyncSummary(
      {
        schemaVersion: 'v1',
        stats: { users: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 0 } },
      },
      false
    );

    expect(summary).toContain('No changes — databases already in sync.');
  });

  it('appends conflict and deleted suffixes only when nonzero', () => {
    const summary = buildSyncSummary(
      {
        stats: {
          users: { devToProd: 1, prodToDev: 0, conflicts: 2, deleted: 3 },
          personas: { devToProd: 4, prodToDev: 0, conflicts: 0, deleted: 0 },
        },
      },
      false
    );

    expect(summary).toContain('`users`: 1 dev→prod, 0 prod→dev, 2 conflicts, 3 deleted');
    expect(summary).toContain('`personas`: 4 dev→prod, 0 prod→dev');
    expect(summary).not.toContain('`personas`: 4 dev→prod, 0 prod→dev,');
  });
});

describe('buildSyncReportMarkdown', () => {
  const baseResult = {
    timestamp: '2026-07-11T00:00:00.000Z',
    schemaVersion: '20260710230428_add_sync_tombstones',
    stats: {
      users: { devToProd: 3, prodToDev: 1, conflicts: 0, deleted: 0 },
      personas: { devToProd: 0, prodToDev: 0, conflicts: 0, deleted: 2 },
    },
    warnings: ['personas: 2 conflicts resolved using last-write-wins'],
    info: ["Table 'audit_log' excluded: local-only audit trail"],
    deletions: [
      { table: 'personas', rowKey: 'aaaa-1111', target: 'prod' as const },
      { table: 'personas', rowKey: 'bbbb-2222', target: 'dev' as const },
    ],
    deletionsTruncated: false,
  };

  it('includes EVERY table in the stats table, active or not', () => {
    const report = buildSyncReportMarkdown(baseResult, false);

    expect(report).toContain('| users | 3 | 1 | 0 | 0 |');
    expect(report).toContain('| personas | 0 | 0 | 0 | 2 |');
  });

  it('lists each deletion row with its losing side', () => {
    const report = buildSyncReportMarkdown(baseResult, false);

    expect(report).toContain('## Deletions queued for propagation (2)');
    expect(report).toContain('- `personas` · `aaaa-1111` → prod');
    expect(report).toContain('- `personas` · `bbbb-2222` → dev');
  });

  it('uses would-propagate framing under dry run', () => {
    const report = buildSyncReportMarkdown(baseResult, true);

    expect(report).toContain('# Database Sync Report (dry run)');
    expect(report).toContain('- Mode: DRY RUN — no changes applied');
    expect(report).toContain('## Deletions that would propagate (2)');
  });

  it('marks a gateway-capped deletion list loudly', () => {
    const report = buildSyncReportMarkdown({ ...baseResult, deletionsTruncated: true }, false);

    expect(report).toContain('## Deletions queued for propagation (2+)');
    expect(report).toContain('Row detail capped by the gateway');
  });

  it('carries full warnings and info without truncation', () => {
    const manyWarnings = Array.from({ length: 60 }, (_, i) => `warning line ${i}`);
    const report = buildSyncReportMarkdown({ ...baseResult, warnings: manyWarnings }, false);

    expect(report).toContain('## Warnings (60)');
    expect(report).toContain('- warning line 0');
    expect(report).toContain('- warning line 59');
    expect(report).toContain("- Table 'audit_log' excluded: local-only audit trail");
  });

  it('renders explicit None sections for an empty result', () => {
    const report = buildSyncReportMarkdown({}, false);

    expect(report).toContain('_No table stats returned._');
    expect(report).toContain('## Deletions queued for propagation (0)');
    expect(report).toContain('## Warnings (0)');
    expect(report).toContain('None.');
  });
});
