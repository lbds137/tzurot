/**
 * Tests for the memory batch CONFIRM flow (memoriesBatchConfirm.ts) — the
 * Delete / Lock run, label resolution, and the outcome-report delivery.
 * The entry/pick/render half lives in memoriesBatch.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';

import { handleMemoryBatchConfirm } from './memoriesBatchConfirm.js';
import { encodeBatchFooterIds } from '../../utils/browse/multiSelectBatch.js';
import { GatewayClientError } from '@tzurot/clients';
import type { MemoryItem } from '@tzurot/common-types/schemas/api/memory';
import { asUserClient } from '../../test/gatewayClientStubs.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({ clientsFor: clientsForMock }));

const sessionManagerMock = vi.hoisted(() => ({
  findByMessageId: vi.fn(),
}));
vi.mock('./browseSession.js', () => ({
  findMemoryListSessionByMessage: (...args: unknown[]) =>
    sessionManagerMock.findByMessageId(...args),
}));

vi.mock('./detail.js', () => ({
  // Same deterministic stub the browse/search tests use — buildMemoryActionId
  // is a pure string-builder.
  buildMemoryActionId: (action: string, id?: string) =>
    id !== undefined ? `memory-detail::${action}::${id}` : `memory-detail::${action}`,
}));

vi.mock('./detailApi.js', () => ({
  fetchMemory: (...args: unknown[]) => mockFetchMemory(...args),
  setMemoryLock: (...args: unknown[]) => mockSetMemoryLock(...args),
  deleteMemory: (...args: unknown[]) => mockDeleteMemory(...args),
}));

const {
  mockFetchMemory,
  mockSetMemoryLock,
  mockDeleteMemory,
  mockFetchMemories,
  mockFetchSearchResults,
  mockBuildBrowseEmbed,
  mockBuildRefreshedBrowseView,
  mockBuildRefreshedSearchView,
} = vi.hoisted(() => ({
  mockFetchMemory: vi.fn(),
  mockSetMemoryLock: vi.fn(),
  mockDeleteMemory: vi.fn(),
  mockFetchMemories: vi.fn(),
  mockFetchSearchResults: vi.fn(),
  mockBuildBrowseEmbed: vi.fn(),
  mockBuildRefreshedBrowseView: vi.fn(),
  mockBuildRefreshedSearchView: vi.fn(),
}));

vi.mock('./browse.js', () => ({
  MEMORIES_PER_PAGE: 10,
  fetchMemories: (...args: unknown[]) => mockFetchMemories(...args),
  buildBrowseEmbed: (...args: unknown[]) => mockBuildBrowseEmbed(...args),
  buildRefreshedBrowseView: (...args: unknown[]) => mockBuildRefreshedBrowseView(...args),
  // The real shape — labels asserted in the confirm tests must match
  // what production renders.
  formatMemorySelectOption: (memory: MemoryItem) => ({
    label: `${memory.isLocked ? '🔐 ' : ''}${memory.content}`,
    value: memory.id,
    description: `${memory.personalityName} · ${memory.createdAt}`,
  }),
}));

vi.mock('./search.js', () => ({
  fetchSearchResults: (...args: unknown[]) => mockFetchSearchResults(...args),
  buildSearchEmbed: vi.fn(() => ({ kind: 'search-embed' })),
  computeTotalPages: (page: number, hasMore: boolean, resultCount: number) =>
    hasMore ? page + 2 : Math.max(1, page + (resultCount > 0 ? 1 : 0)),
  buildRefreshedSearchView: (...args: unknown[]) => mockBuildRefreshedSearchView(...args),
}));

// The confirm module imports its page/label helpers from memoriesBatch.js —
// left UNMOCKED so the confirm half of the flow runs against the same mocks
// above (a wiring change at that seam breaks these tests instead of hiding).

const MEMORY_IDS = ['mem-1', 'mem-2', 'mem-3', 'mem-4', 'mem-5'];

const createMockMemory = (id: string, overrides: Partial<MemoryItem> = {}): MemoryItem => ({
  id,
  personalityId: 'personality-456',
  personalityName: 'Test Personality',
  content: `Content of ${id}`,
  isLocked: false,
  createdAt: '2026-06-15T12:00:00.000Z',
  updatedAt: '2026-06-15T12:00:00.000Z',
  ...overrides,
});

const MEMORIES = MEMORY_IDS.map(id => createMockMemory(id));

function browseResponse(memories: MemoryItem[], total = memories.length) {
  return { memories, total, limit: 10, offset: 0, hasMore: false };
}

const BROWSE_SESSION = {
  data: { kind: 'browse' as const, personalityId: 'personality-456', currentPage: 0 },
};
const SEARCH_SESSION = {
  data: {
    kind: 'search' as const,
    personalityId: 'personality-456',
    currentPage: 0,
    searchQuery: 'love',
    pageSize: 5,
    searchType: undefined as 'semantic' | 'text' | undefined,
  },
};

function createButtonInteraction(options: {
  messageEmbedFooter?: string;
  deferred?: boolean;
}): ButtonInteraction {
  return {
    user: { id: 'user-1' },
    customId: 'memory-detail::batch-confirm::delete',
    message: {
      id: 'message-1',
      embeds: options.messageEmbedFooter ? [{ footer: { text: options.messageEmbedFooter } }] : [],
      components: [],
    },
    deferred: options.deferred ?? false,
    replied: false,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction;
}

interface EmbedData {
  title?: string;
  description?: string;
  color?: number;
  footer?: { text: string };
}

interface EditReplyPayload {
  embeds?: unknown[];
  components?: unknown[];
}

/** The mocked interaction's LAST editReply payload (the confirm flow edits several times). */
function editReplyPayload(interaction: unknown): EditReplyPayload {
  const calls = (interaction as { editReply: { mock: { calls: unknown[][] } } }).editReply.mock
    .calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as EditReplyPayload;
}

function toEmbedData(embed: unknown): EmbedData {
  if (typeof embed === 'object' && embed !== null && 'data' in embed) {
    return (embed as { data: EmbedData }).data;
  }
  return embed as EmbedData;
}

function editReplyEmbeds(interaction: unknown): EmbedData[] {
  return (editReplyPayload(interaction).embeds ?? []).map(toEmbedData);
}

describe('handleMemoryBatchConfirm — delete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientsForMock.mockReturnValue({ userClient: asUserClient({}) });
    mockFetchMemories.mockResolvedValue(browseResponse(MEMORIES));
    mockBuildRefreshedBrowseView.mockResolvedValue({
      embed: { kind: 'refreshed-browse' },
      components: [],
    });
    mockBuildRefreshedSearchView.mockResolvedValue({
      embed: { kind: 'refreshed-search' },
      components: [],
    });
  });

  it('strips the confirm components BEFORE the first fetch and the loop', async () => {
    mockDeleteMemory.mockResolvedValue(true);
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1']),
    });

    await handleMemoryBatchConfirm(interaction, 'delete', BROWSE_SESSION);

    const firstEdit = vi.mocked(interaction.editReply).mock.calls[0]?.[0] as EditReplyPayload;
    expect(firstEdit).toEqual({ components: [] });
    const stripOrder = vi.mocked(interaction.editReply).mock.invocationCallOrder[0];
    expect(stripOrder).toBeLessThan(mockFetchMemories.mock.invocationCallOrder[0]);
    expect(stripOrder).toBeLessThan(mockDeleteMemory.mock.invocationCallOrder[0]);
  });

  it('names the locked 403 AND the successes, and reaches every id (C1, partial failure)', async () => {
    // mem-2 is locked: the gateway 403s its delete mid-list; 1/3/4/5 must
    // still be attempted and named with their REAL content from the PRE-LOOP
    // fetch. The mocked detailApi translates a 403 result into the
    // GatewayClientError the real collapse helpers throw.
    mockFetchMemories.mockResolvedValue(browseResponse(MEMORIES));
    mockDeleteMemory.mockImplementation((_userClient: unknown, memoryId: string) =>
      memoryId === 'mem-2'
        ? Promise.reject(
            new GatewayClientError({
              ok: false,
              status: 403,
              error: 'Cannot delete a locked memory',
              kind: 'http',
            })
          )
        : Promise.resolve(true)
    );
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(MEMORY_IDS),
    });

    await handleMemoryBatchConfirm(interaction, 'delete', BROWSE_SESSION);

    // The loop reached ALL five ids — the locked 403 never stops the run.
    expect(mockDeleteMemory).toHaveBeenCalledTimes(5);
    for (const id of MEMORY_IDS) {
      expect(mockDeleteMemory).toHaveBeenCalledWith(expect.anything(), id, 'user-1');
    }

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.title).toContain('Delete');
    expect(resultEmbed.description).toContain('✅ Content of mem-1');
    // A success AFTER the failed item — the run continued past the failure.
    expect(resultEmbed.description).toContain('✅ Content of mem-4');
    expect(resultEmbed.description).toContain('🔐 Content of mem-2');
    expect(resultEmbed.description).toContain('locked — unlock first');

    // The list refresh rode the same reply (result embed on top, list under).
    const embeds = editReplyEmbeds(interaction);
    expect(embeds).toHaveLength(2);
  });

  it('runs the DELETE past a failed per-id read: fallback label, never a ❌ (delete-side drift)', async () => {
    // mem-1 fell off the page AND its per-id read throws. A delete needs no
    // lock state, so the read failure must not gate the run: the id still
    // executes, and its line carries the id-prefix fallback label.
    mockFetchMemories.mockResolvedValue(browseResponse(MEMORIES.slice(1)));
    mockFetchMemory.mockRejectedValue(new Error('read failed'));
    mockDeleteMemory.mockResolvedValue(true);
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1']),
    });

    await handleMemoryBatchConfirm(interaction, 'delete', BROWSE_SESSION);

    expect(mockDeleteMemory).toHaveBeenCalledWith(expect.anything(), 'mem-1', 'user-1');
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('Memory ID: mem-1');
    expect(resultEmbed.description).not.toContain('❌');
  });

  it('renders an already-gone delete (false) as its own outcome, not an error', async () => {
    mockDeleteMemory.mockResolvedValue(false);
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1']),
    });

    await handleMemoryBatchConfirm(interaction, 'delete', BROWSE_SESSION);

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('◻️');
    expect(resultEmbed.description).toContain('already gone');
    expect(resultEmbed.description).not.toContain('❌');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.WARNING);
  });

  it('skips the delete for an id whose per-id read 404s: no gateway call, ◻️ already gone', async () => {
    // The pre-loop read already confirmed the 404 — the delete call would
    // only return false. mem-1 is gone; mem-2 must still run.
    mockFetchMemories.mockResolvedValue(browseResponse(MEMORIES.slice(1)));
    mockFetchMemory.mockResolvedValue(null);
    mockDeleteMemory.mockResolvedValue(true);
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1', 'mem-2']),
    });

    await handleMemoryBatchConfirm(interaction, 'delete', BROWSE_SESSION);

    expect(mockDeleteMemory).toHaveBeenCalledTimes(1);
    expect(mockDeleteMemory).toHaveBeenCalledWith(expect.anything(), 'mem-2', 'user-1');
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('◻️ Memory ID: mem-1');
    expect(resultEmbed.description).toContain('already gone');
    expect(resultEmbed.description).not.toContain('❌ Memory ID: mem-1');
    // One sibling id still succeeded, so the ladder gives SUCCESS — WARNING
    // is only for a run where nothing succeeded AND nothing failed.
    expect(resultEmbed.color).toBe(DISCORD_COLORS.SUCCESS);
  });

  it('retries the reply with the result embed alone when the stacked editReply rejects', async () => {
    mockDeleteMemory.mockResolvedValue(true);
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1']),
    });
    vi.mocked(interaction.editReply)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('Invalid Form Body'));

    await handleMemoryBatchConfirm(interaction, 'delete', BROWSE_SESSION);

    expect(mockDeleteMemory).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledTimes(3);
    const fallback = (vi.mocked(interaction.editReply).mock.calls[2]?.[0] ??
      {}) as EditReplyPayload;
    expect(fallback.embeds).toHaveLength(1);
    expect(fallback.components).toEqual([]);
  });

  it('falls back to a plain ephemeral followUp with the counts when BOTH editReply attempts reject', async () => {
    mockDeleteMemory.mockResolvedValue(true);
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1']),
    });
    vi.mocked(interaction.editReply)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('Invalid Form Body'))
      .mockRejectedValueOnce(new Error('Unknown Message'));

    await handleMemoryBatchConfirm(interaction, 'delete', BROWSE_SESSION);

    expect(mockDeleteMemory).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledTimes(3);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('1 succeeded'),
        flags: MessageFlags.Ephemeral,
      })
    );
  });

  it('survives a throwing refreshed-view round-trip after the mutations ran', async () => {
    // The session lookup for the refreshed view throws AFTER deleteMemory —
    // the report must still reach the user via the result-only reply.
    mockDeleteMemory.mockResolvedValue(true);
    mockBuildRefreshedBrowseView.mockRejectedValue(new Error('session manager down'));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1']),
    });

    await expect(
      handleMemoryBatchConfirm(interaction, 'delete', BROWSE_SESSION)
    ).resolves.toBeUndefined();

    expect(mockDeleteMemory).toHaveBeenCalledTimes(1);
    const payload = editReplyPayload(interaction);
    expect(payload.embeds).toHaveLength(1);
    expect(payload.components).toEqual([]);
  });

  it('refuses with the re-run copy, before any mutation, when the pre-loop page fetch fails', async () => {
    mockFetchMemories.mockResolvedValue(null);
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1']),
    });

    await handleMemoryBatchConfirm(interaction, 'delete', BROWSE_SESSION);

    // The buttons are already stripped, so nothing on this message is
    // retryable — the copy asks for a fresh run, not a bare "try again later".
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Couldn't load that page"),
      })
    );
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('run the command again') })
    );
    expect(mockDeleteMemory).not.toHaveBeenCalled();
    expect(mockSetMemoryLock).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(interaction.editReply).mock.calls[0]?.[0]).toEqual({ components: [] });
  });

  it('skips the ack when the router already deferred', async () => {
    mockDeleteMemory.mockResolvedValue(true);
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1']),
      deferred: true,
    });

    await handleMemoryBatchConfirm(interaction, 'delete', BROWSE_SESSION);

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });

  it('asks for a retry when the footer carries no ids (expired/tampered view)', async () => {
    const interaction = createButtonInteraction({});

    await handleMemoryBatchConfirm(interaction, 'delete', BROWSE_SESSION);

    expect(interaction.followUp).toHaveBeenCalled();
    expect(mockDeleteMemory).not.toHaveBeenCalled();
    expect(mockSetMemoryLock).not.toHaveBeenCalled();
  });

  it('recovers a drifted id with a per-id fetch: the success line carries the REAL content', async () => {
    // mem-1 fell off the page between pick and confirm — the per-id read
    // restores its real content, so the line is not an id-prefix fallback.
    mockFetchMemories.mockResolvedValue(browseResponse(MEMORIES.slice(1)));
    mockFetchMemory.mockResolvedValue(createMockMemory('mem-1'));
    mockDeleteMemory.mockResolvedValue(true);
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1']),
    });

    await handleMemoryBatchConfirm(interaction, 'delete', BROWSE_SESSION);

    expect(mockFetchMemory).toHaveBeenCalledWith(expect.anything(), 'mem-1', 'user-1');
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('✅ Content of mem-1');
    expect(resultEmbed.description).not.toContain('Memory ID:');
  });

  it('skips the page fetch for a SEARCH session: every label via the per-id read (C4)', async () => {
    // A search session never re-runs its query for labels — no semantic
    // re-search, no embedding round-trip. The selected id resolves per-id and
    // the refreshed view still dispatches to the search refresh.
    mockFetchMemory.mockResolvedValue(createMockMemory('mem-1'));
    mockDeleteMemory.mockResolvedValue(true);
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1']),
    });

    await handleMemoryBatchConfirm(interaction, 'delete', SEARCH_SESSION);

    expect(mockFetchMemories).not.toHaveBeenCalled();
    expect(mockFetchSearchResults).not.toHaveBeenCalled();
    expect(mockFetchMemory).toHaveBeenCalledWith(expect.anything(), 'mem-1', 'user-1');
    expect(mockBuildRefreshedSearchView).toHaveBeenCalledWith(interaction);
    expect(mockBuildRefreshedBrowseView).not.toHaveBeenCalled();
    const embeds = editReplyEmbeds(interaction);
    expect(embeds).toHaveLength(2);
  });
});

describe('handleMemoryBatchConfirm — lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientsForMock.mockReturnValue({ userClient: asUserClient({}) });
    mockFetchMemories.mockResolvedValue(browseResponse(MEMORIES));
    mockBuildRefreshedBrowseView.mockResolvedValue({
      embed: { kind: 'refreshed-browse' },
      components: [],
    });
    mockSetMemoryLock.mockImplementation((memoryId: string) =>
      Promise.resolve(createMockMemory(memoryId, { isLocked: true }))
    );
  });

  it('locks every selected memory with the explicit target state, SUCCESS color on an all-success run', async () => {
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1', 'mem-3']),
    });

    await handleMemoryBatchConfirm(interaction, 'lock', BROWSE_SESSION);

    expect(mockSetMemoryLock).toHaveBeenCalledWith(expect.anything(), 'mem-1', true, 'user-1');
    expect(mockSetMemoryLock).toHaveBeenCalledWith(expect.anything(), 'mem-3', true, 'user-1');

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.title).toContain('Lock');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.SUCCESS);
    expect(resultEmbed.description).toContain('✅ Content of mem-1');
    expect(resultEmbed.description).toContain('✅ Content of mem-3');
  });

  it('renders the ERROR color when any item of the run fails', async () => {
    mockSetMemoryLock.mockImplementation((_userClient: unknown, memoryId: string) =>
      memoryId === 'mem-2'
        ? Promise.reject(new Error('internal error'))
        : Promise.resolve(createMockMemory(memoryId, { isLocked: true }))
    );
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1', 'mem-2']),
    });

    await handleMemoryBatchConfirm(interaction, 'lock', BROWSE_SESSION);

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
    expect(resultEmbed.description).toContain('✅ Content of mem-1');
    expect(resultEmbed.description).toContain('❌ Content of mem-2');
  });

  it('renders a 403 on a LOCK run as a failed line, NOT locked (the mapping is delete-gated)', async () => {
    // The gateway's locked-rejection rendering is delete/forget-only: a lock
    // 403 is a real failure with its classified reason.
    mockSetMemoryLock.mockRejectedValue(
      new GatewayClientError({ ok: false, status: 403, error: 'Forbidden', kind: 'http' })
    );
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1']),
    });

    await handleMemoryBatchConfirm(interaction, 'lock', BROWSE_SESSION);

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
    expect(resultEmbed.description).toContain('❌');
    expect(resultEmbed.description).not.toContain('locked — unlock first');
    expect(resultEmbed.description).not.toContain('— already locked');
  });

  it('skips known-locked memories as their own outcome and locks only the unlocked', async () => {
    const mixed = [
      createMockMemory('mem-1', { isLocked: true }),
      createMockMemory('mem-2'),
      createMockMemory('mem-3', { isLocked: true }),
    ];
    mockFetchMemories.mockResolvedValue(browseResponse(mixed));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1', 'mem-2', 'mem-3']),
    });

    await handleMemoryBatchConfirm(interaction, 'lock', BROWSE_SESSION);

    expect(mockSetMemoryLock).toHaveBeenCalledTimes(1);
    expect(mockSetMemoryLock).toHaveBeenCalledWith(expect.anything(), 'mem-2', true, 'user-1');

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('🔐 Content of mem-1 — already locked');
    expect(resultEmbed.description).toContain('🔐 Content of mem-3 — already locked');
    expect(resultEmbed.description).toContain('✅ Content of mem-2');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.SUCCESS);
  });

  it('never re-locks an id whose lock state could not be resolved: failed line, no mutation', async () => {
    // mem-1 is missing from the page AND its per-id read THROWS — its lock
    // state is unknowable, so a lock run must not call setMemoryLock(true)
    // and risk reporting ✅ for an already-locked memory.
    mockFetchMemories.mockResolvedValue(browseResponse(MEMORIES.slice(1)));
    mockFetchMemory.mockRejectedValue(new Error('read failed'));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1', 'mem-2']),
    });

    await handleMemoryBatchConfirm(interaction, 'lock', BROWSE_SESSION);

    expect(mockSetMemoryLock).toHaveBeenCalledTimes(1);
    expect(mockSetMemoryLock).toHaveBeenCalledWith(expect.anything(), 'mem-2', true, 'user-1');

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('❌ Memory ID: mem-1');
    expect(resultEmbed.description).toContain('✅ Content of mem-2');
  });

  it('resolves a drifted id through the per-id fetch and skips it when already locked', async () => {
    // The page fetch misses the now-locked mem-1; the per-id read restores
    // its state — the lock run skips it WITHOUT a setMemoryLock call and
    // reports the locked outcome, not a ✅ for a no-op.
    mockFetchMemories.mockResolvedValue(browseResponse(MEMORIES.slice(1)));
    mockFetchMemory.mockResolvedValue(createMockMemory('mem-1', { isLocked: true }));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1', 'mem-2']),
    });

    await handleMemoryBatchConfirm(interaction, 'lock', BROWSE_SESSION);

    expect(mockSetMemoryLock).toHaveBeenCalledTimes(1);
    expect(mockSetMemoryLock).toHaveBeenCalledWith(expect.anything(), 'mem-2', true, 'user-1');

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('🔐 Content of mem-1 — already locked');
    expect(resultEmbed.description).toContain('✅ Content of mem-2');
  });

  it('renders a gone memory (per-id read 404, setMemoryLock null) as already gone', async () => {
    mockFetchMemories.mockResolvedValue(browseResponse(MEMORIES.slice(1)));
    mockFetchMemory.mockResolvedValue(null);
    mockSetMemoryLock.mockResolvedValue(null);
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1']),
    });

    await handleMemoryBatchConfirm(interaction, 'lock', BROWSE_SESSION);

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('◻️');
    expect(resultEmbed.description).toContain('already gone');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.WARNING);
  });

  it('skips the lock for an id whose per-id read 404s: no setMemoryLock call, ◻️ already gone', async () => {
    // The pre-loop read already confirmed the 404 — the lock call would only
    // return null. mem-1 is gone; mem-2 must still lock.
    mockFetchMemories.mockResolvedValue(browseResponse(MEMORIES.slice(1)));
    mockFetchMemory.mockResolvedValue(null);
    mockSetMemoryLock.mockResolvedValue(createMockMemory('mem-2', { isLocked: true }));
    mockBuildRefreshedSearchView.mockResolvedValue({ embed: {}, components: [] });
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1', 'mem-2']),
    });

    await handleMemoryBatchConfirm(interaction, 'lock', BROWSE_SESSION);

    expect(mockSetMemoryLock).toHaveBeenCalledTimes(1);
    expect(mockSetMemoryLock).toHaveBeenCalledWith(expect.anything(), 'mem-2', true, 'user-1');
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('◻️ Memory ID: mem-1');
    expect(resultEmbed.description).toContain('already gone');
    expect(resultEmbed.description).toContain('✅ Content of mem-2');
  });

  it('fails an unverifiable per-id read on a SEARCH lock run: ❌ line, no setMemoryLock for it', async () => {
    // On a search session EVERY label rides the per-id read — the guard
    // against re-locking an id with an unknowable lock state is most exposed
    // exactly here. The thrown read is a real unknown (not a 404): ❌ failed,
    // and the untouched sibling id still locks.
    mockFetchMemory.mockImplementation((_client: unknown, id: string) =>
      id === 'mem-1'
        ? Promise.reject(new Error('read failed'))
        : Promise.resolve(createMockMemory(id))
    );
    mockSetMemoryLock.mockResolvedValue(createMockMemory('mem-2', { isLocked: true }));
    mockBuildRefreshedSearchView.mockResolvedValue({ embed: {}, components: [] });
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['mem-1', 'mem-2']),
    });

    await handleMemoryBatchConfirm(interaction, 'lock', SEARCH_SESSION);

    expect(mockFetchMemories).not.toHaveBeenCalled();
    expect(mockSetMemoryLock).toHaveBeenCalledTimes(1);
    expect(mockSetMemoryLock).toHaveBeenCalledWith(expect.anything(), 'mem-2', true, 'user-1');
    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('❌ Memory ID: mem-1');
    expect(resultEmbed.description).not.toContain('◻️ Memory ID: mem-1');
    expect(resultEmbed.description).toContain('✅ Content of mem-2');
  });
});
