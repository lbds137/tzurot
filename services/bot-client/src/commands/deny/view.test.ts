import { describe, it, expect, vi, beforeEach } from 'vitest';
import { escapeMarkdown } from 'discord.js';
import { handleView } from './view.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { asOwnerClient } from '../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: vi.fn(() => ({
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
      warn: vi.fn(),
    })),
  };
});

vi.mock('../../utils/commandContext/index.js', () => ({
  requireBotOwnerContext: vi.fn(),
}));

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

// Pass through the real browse module; only the gateway fetch is stubbed, and
// the route's `truncated` flag rides in each ok payload.
vi.mock('./browse.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./browse.js')>();
  return { ...actual, fetchEntriesResult: vi.fn() };
});

vi.mock('./detail.js', () => ({
  showDetailView: vi.fn(),
}));

import { DENYLIST_LIST_MAX_ENTRIES } from '@tzurot/common-types/schemas/api/denylist';
import { requireBotOwnerContext } from '../../utils/commandContext/index.js';
import { fetchEntriesResult, type DenylistFetchResult } from './browse.js';
import type { DenylistEntryResponse } from './browseTypes.js';
import { showDetailView } from './detail.js';
import { formatTypeLabel } from '../../commands/deny/denyLabels.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

function createMockContext(options: Record<string, unknown> = {}): DeferredCommandContext {
  const optionMap = new Map(Object.entries(options));
  return {
    user: { id: 'owner-1' },
    interaction: {
      user: { id: 'owner-1' },
    },
    getOption: vi.fn((name: string) => optionMap.get(name) ?? null),
    editReply: vi.fn(),
  } as unknown as DeferredCommandContext;
}

const ENTRY_USER = {
  id: 'entry-1',
  type: 'USER' as const,
  discordId: '999888777',
  scope: 'BOT' as const,
  scopeId: '*',
  mode: 'BLOCK' as const,
  reason: 'spam',
  addedAt: new Date('2026-01-01T00:00:00Z'),
  addedBy: 'owner-1',
};

const ENTRY_GUILD = {
  id: 'entry-2',
  type: 'GUILD' as const,
  discordId: '999888777',
  scope: 'BOT' as const,
  scopeId: '*',
  mode: 'BLOCK' as const,
  reason: null,
  addedAt: new Date('2026-01-02T00:00:00Z'),
  addedBy: 'owner-1',
};

function buildEntries(count: number): DenylistEntryResponse[] {
  return Array.from({ length: count }, (_, idx) => ({
    ...ENTRY_USER,
    id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
    discordId: `100000000000${String(idx + 1).padStart(6, '0')}`,
  }));
}

describe('handleView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    clientsForMock.mockReturnValue({
      ownerClient: asOwnerClient({ listDenylistEntries: vi.fn() }),
    });
    vi.mocked(requireBotOwnerContext).mockResolvedValue(true);
  });

  it('should stop if not bot owner', async () => {
    vi.mocked(requireBotOwnerContext).mockResolvedValue(false);
    const context = createMockContext({ target: '999888777' });

    await handleView(context);

    expect(fetchEntriesResult).not.toHaveBeenCalled();
  });

  it('should reject empty target', async () => {
    const context = createMockContext({ target: '  ' });

    await handleView(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Please provide a Discord user or server ID')
    );
  });

  it('should reject missing target', async () => {
    const context = createMockContext({});

    await handleView(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Please provide a Discord user or server ID')
    );
  });

  it('renders the classified copy of the fetch failure', async () => {
    // Typed against the real fetch-result union: an interface move that this
    // mock payload no longer satisfies breaks the test at compile time.
    const failure = { ok: false as const, kind: 'http' as const, error: 'boom', status: 500 };
    vi.mocked(fetchEntriesResult).mockResolvedValue({
      ok: false,
      failure,
    } satisfies DenylistFetchResult);
    const context = createMockContext({ target: '999888777' });

    await handleView(context);

    expect(context.editReply).toHaveBeenCalledWith(
      renderSpec(classifyGatewayFailure(failure, 'entry', { operation: 'read' }))
    );
  });

  it('should show not-found message when no matches', async () => {
    vi.mocked(fetchEntriesResult).mockResolvedValue({ ok: true, entries: [], truncated: false });
    const context = createMockContext({ target: '111222333' });

    await handleView(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No denylist entries found for `111222333`')
    );
  });

  it('should include type filter in not-found message', async () => {
    vi.mocked(fetchEntriesResult).mockResolvedValue({
      ok: true,
      entries: [ENTRY_USER],
      truncated: false,
    });
    const context = createMockContext({ target: '111222333', type: 'guild' });

    await handleView(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('(type: Server)'));
  });

  it('reports a cap-aware miss through the catalog when the fetch reports truncated and nothing matches', async () => {
    vi.mocked(fetchEntriesResult).mockResolvedValue({
      ok: true,
      entries: buildEntries(2),
      truncated: true,
    });
    const context = createMockContext({ target: '111222333' });

    await handleView(context);

    expect(context.editReply).toHaveBeenCalledWith(
      renderSpec(
        CATALOG.error.validation(
          `Couldn't find \`111222333\` in the newest ${DENYLIST_LIST_MAX_ENTRIES} entries — if it still exists, remove it with /deny remove.`
        )
      )
    );
  });

  it('escapes a markdown-bearing target in the at-cap miss copy', async () => {
    vi.mocked(fetchEntriesResult).mockResolvedValue({
      ok: true,
      entries: buildEntries(2),
      truncated: true,
    });
    // Backtick inside the target would otherwise break out of the inline-code
    // span; the expected string derives the escaped form, never hand-escapes.
    const target = 'abc`def';
    const context = createMockContext({ target });

    await handleView(context);

    expect(context.editReply).toHaveBeenCalledWith(
      renderSpec(
        CATALOG.error.validation(
          `Couldn't find \`${escapeMarkdown(target)}\` in the newest ${DENYLIST_LIST_MAX_ENTRIES} entries — if it still exists, remove it with /deny remove.`
        )
      )
    );
  });

  it('keeps the plain not-found copy when the fetch reports not truncated and nothing matches', async () => {
    vi.mocked(fetchEntriesResult).mockResolvedValue({
      ok: true,
      entries: [ENTRY_USER],
      truncated: false,
    });
    const context = createMockContext({ target: '111222333' });

    await handleView(context);

    expect(context.editReply).toHaveBeenCalledWith('No denylist entries found for `111222333`.');
  });

  it('pins the type note placement in the at-cap miss copy', async () => {
    vi.mocked(fetchEntriesResult).mockResolvedValue({
      ok: true,
      entries: buildEntries(2),
      truncated: true,
    });
    const context = createMockContext({ target: '111222333', type: 'guild' });

    await handleView(context);

    expect(context.editReply).toHaveBeenCalledWith(
      renderSpec(
        CATALOG.error.validation(
          `Couldn't find \`111222333\` in the newest ${DENYLIST_LIST_MAX_ENTRIES} entries (type: ${formatTypeLabel('guild')}) — if it still exists, remove it with /deny remove.`
        )
      )
    );
  });

  it('should show detail view for single match', async () => {
    vi.mocked(fetchEntriesResult).mockResolvedValue({
      ok: true,
      entries: [ENTRY_USER],
      truncated: false,
    });
    const context = createMockContext({ target: '999888777' });

    await handleView(context);

    expect(showDetailView).toHaveBeenCalledWith(context.interaction, ENTRY_USER, null);
  });

  it('should show first match with multi-match note when multiple entries found', async () => {
    vi.mocked(fetchEntriesResult).mockResolvedValue({
      ok: true,
      entries: [ENTRY_USER, ENTRY_GUILD],
      truncated: false,
    });
    const context = createMockContext({ target: '999888777' });

    await handleView(context);

    expect(showDetailView).toHaveBeenCalledWith(
      context.interaction,
      ENTRY_USER,
      null,
      expect.stringContaining('Found 2 entries')
    );
  });

  it('should filter by type when provided', async () => {
    vi.mocked(fetchEntriesResult).mockResolvedValue({
      ok: true,
      entries: [ENTRY_USER, ENTRY_GUILD],
      truncated: false,
    });
    const context = createMockContext({ target: '999888777', type: 'guild' });

    await handleView(context);

    expect(showDetailView).toHaveBeenCalledWith(context.interaction, ENTRY_GUILD, null);
  });
});
