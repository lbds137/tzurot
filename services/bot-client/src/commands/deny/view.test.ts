import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleView } from './view.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

vi.mock('@tzurot/common-types', () => ({
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  })),
}));

vi.mock('../../utils/commandContext/index.js', () => ({
  requireBotOwnerContext: vi.fn(),
}));

vi.mock('./browse.js', () => ({
  fetchEntries: vi.fn(),
}));

vi.mock('./detail.js', () => ({
  showDetailView: vi.fn(),
}));

import { requireBotOwnerContext } from '../../utils/commandContext/index.js';
import { fetchEntries } from './browse.js';
import { showDetailView } from './detail.js';

function createMockContext(options: Record<string, unknown> = {}): DeferredCommandContext {
  const optionMap = new Map(Object.entries(options));
  return {
    user: { id: 'owner-1' },
    interaction: {},
    getOption: vi.fn((name: string) => optionMap.get(name) ?? null),
    editReply: vi.fn(),
  } as unknown as DeferredCommandContext;
}

const ENTRY_USER = {
  id: 'entry-1',
  type: 'USER',
  discordId: '999888777',
  scope: 'BOT',
  scopeId: '*',
  mode: 'BLOCK',
  reason: 'spam',
  addedAt: '2026-01-01T00:00:00Z',
  addedBy: 'owner-1',
};

const ENTRY_GUILD = {
  id: 'entry-2',
  type: 'GUILD',
  discordId: '999888777',
  scope: 'BOT',
  scopeId: '*',
  mode: 'BLOCK',
  reason: null,
  addedAt: '2026-01-02T00:00:00Z',
  addedBy: 'owner-1',
};

describe('handleView', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireBotOwnerContext).mockResolvedValue(true);
  });

  it('should stop if not bot owner', async () => {
    vi.mocked(requireBotOwnerContext).mockResolvedValue(false);
    const context = createMockContext({ target: '999888777' });

    await handleView(context);

    expect(fetchEntries).not.toHaveBeenCalled();
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

  it('should handle fetch failure', async () => {
    vi.mocked(fetchEntries).mockResolvedValue(null);
    const context = createMockContext({ target: '999888777' });

    await handleView(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch denylist entries')
    );
  });

  it('should show not-found message when no matches', async () => {
    vi.mocked(fetchEntries).mockResolvedValue([]);
    const context = createMockContext({ target: '111222333' });

    await handleView(context);

    expect(context.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No denylist entries found for `111222333`')
    );
  });

  it('should include type filter in not-found message', async () => {
    vi.mocked(fetchEntries).mockResolvedValue([ENTRY_USER]);
    const context = createMockContext({ target: '111222333', type: 'guild' });

    await handleView(context);

    expect(context.editReply).toHaveBeenCalledWith(expect.stringContaining('(type: GUILD)'));
  });

  it('should show detail view for single match', async () => {
    vi.mocked(fetchEntries).mockResolvedValue([ENTRY_USER]);
    const context = createMockContext({ target: '999888777' });

    await handleView(context);

    expect(showDetailView).toHaveBeenCalledWith(context.interaction, ENTRY_USER, {
      page: 0,
      filter: 'all',
      sort: 'date',
    });
  });

  it('should show first match with multi-match note when multiple entries found', async () => {
    vi.mocked(fetchEntries).mockResolvedValue([ENTRY_USER, ENTRY_GUILD]);
    const context = createMockContext({ target: '999888777' });

    await handleView(context);

    expect(showDetailView).toHaveBeenCalledWith(
      context.interaction,
      ENTRY_USER,
      { page: 0, filter: 'all', sort: 'date' },
      expect.stringContaining('Found 2 entries')
    );
  });

  it('should filter by type when provided', async () => {
    vi.mocked(fetchEntries).mockResolvedValue([ENTRY_USER, ENTRY_GUILD]);
    const context = createMockContext({ target: '999888777', type: 'guild' });

    await handleView(context);

    expect(showDetailView).toHaveBeenCalledWith(context.interaction, ENTRY_GUILD, {
      page: 0,
      filter: 'all',
      sort: 'date',
    });
  });
});
