/**
 * Tests for the memory batch flow ("Select several") over /memory browse
 * and /memory search — the entry swap, confirm view, and per-kind page
 * render. The confirm execution lives in memoriesBatchConfirm.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonStyle, MessageFlags } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';

import {
  buildMemoryBatchSelectComponents,
  handleMemoryBatchSelectEntry,
  handleMemoryBatchPick,
} from './memoriesBatch.js';
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

const { mockFetchMemories, mockFetchSearchResults, mockBuildBrowseEmbed } = vi.hoisted(() => ({
  mockFetchMemories: vi.fn(),
  mockFetchSearchResults: vi.fn(),
  mockBuildBrowseEmbed: vi.fn(),
}));

vi.mock('./browse.js', () => ({
  MEMORIES_PER_PAGE: 10,
  fetchMemories: (...args: unknown[]) => mockFetchMemories(...args),
  buildBrowseEmbed: (...args: unknown[]) => mockBuildBrowseEmbed(...args),
  // The real shape — labels asserted in the pick tests must match
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
}));

// The page/label helpers of the flow are unmocked so both halves of the flow
// run against the same mocks (a wiring change at that seam breaks these
// tests instead of hiding).

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

function searchResponse(results: MemoryItem[], hasMore = false) {
  return { results, count: results.length, hasMore, searchType: undefined };
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

function createSelectInteraction(
  values: string[],
  messageComponents: unknown[]
): StringSelectMenuInteraction {
  return {
    user: { id: 'user-1' },
    customId: 'memory-detail::batch-select',
    values,
    message: { id: 'message-1', components: messageComponents },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as StringSelectMenuInteraction;
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

/** editReply component rows, JSON-normalized to plain component records. */
function editReplyComponentRows(interaction: unknown): Record<string, unknown>[][] {
  return (editReplyPayload(interaction).components ?? []).map(
    row => (row as { toJSON(): { components: Record<string, unknown>[] } }).toJSON().components
  );
}

describe('buildMemoryBatchSelectComponents (the multi-select swap)', () => {
  it('replaces the single-select with a real multi-select: min 1, max capped at the item count (C3)', () => {
    const rows = buildMemoryBatchSelectComponents(BROWSE_SESSION.data, MEMORIES, 0);
    const selectData = rows[0].toJSON().components[0] as unknown as Record<string, unknown> & {
      custom_id: string;
      min_values: number;
      max_values: number;
      options: { value: string }[];
    };
    expect(selectData.custom_id).toBe('memory-detail::batch-select');
    expect(selectData.min_values).toBe(1);
    // maxValues is the page size (10); the factory caps at the 5-item count.
    expect(selectData.max_values).toBe(5);
    expect(selectData.options.map(o => o.value)).toEqual(MEMORY_IDS);
  });

  it('caps the multi-select at the search session pageSize, not the browse page size', () => {
    const rows = buildMemoryBatchSelectComponents(SEARCH_SESSION.data, MEMORIES.slice(0, 5), 0);
    const selectData = rows[0].toJSON().components[0] as unknown as { max_values: number };
    expect(selectData.max_values).toBe(5);
  });

  it('renders exactly the select row plus a Cancel row — NO pagination buttons (C3)', () => {
    const rows = buildMemoryBatchSelectComponents(BROWSE_SESSION.data, MEMORIES, 0);
    expect(rows).toHaveLength(2);

    const [selectRow, cancelRow] = rows.map(row => row.toJSON().components);
    expect((selectRow[0] as { custom_id?: string }).custom_id).toBe('memory-detail::batch-select');
    expect(cancelRow).toHaveLength(1);
    expect(cancelRow[0]).toMatchObject({
      custom_id: 'memory-detail::batch-cancel',
      label: 'Cancel',
    });
  });
});

describe('handleMemoryBatchSelectEntry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clientsForMock.mockReturnValue({ userClient: asUserClient({}) });
    sessionManagerMock.findByMessageId.mockResolvedValue(BROWSE_SESSION);
    mockBuildBrowseEmbed.mockReturnValue({ kind: 'browse-embed' });
  });

  it('acks FIRST, then re-fetches the page and renders the multi-select swap', async () => {
    mockFetchMemories.mockResolvedValue(browseResponse(MEMORIES));
    const interaction = createButtonInteraction({});

    await handleMemoryBatchSelectEntry(interaction);

    const deferOrder = vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0];
    const fetchOrder = mockFetchMemories.mock.invocationCallOrder[0];
    expect(deferOrder).toBeLessThan(fetchOrder);
    expect(interaction.editReply).toHaveBeenCalled();

    const rows = editReplyComponentRows(interaction);
    const selectData = rows[0][0] as unknown as { max_values: number };
    expect(selectData.max_values).toBe(5);
  });

  it('fetches the SEARCH page with the session query, pageSize, and kept searchType', async () => {
    // The kept first-page searchType is undefined → preferTextSearch stays
    // false (search.ts:446-452: the first page's type is authoritative).
    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { ...SEARCH_SESSION.data, searchType: 'text' },
    });
    mockFetchSearchResults.mockResolvedValue(searchResponse(MEMORIES.slice(0, 5)));
    const interaction = createButtonInteraction({});

    await handleMemoryBatchSelectEntry(interaction);

    expect(mockFetchMemories).not.toHaveBeenCalled();
    expect(mockFetchSearchResults).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'love',
        personalityId: 'personality-456',
        offset: 0,
        limit: 5,
        preferTextSearch: true,
      })
    );
    const rows = editReplyComponentRows(interaction);
    const selectData = rows[0][0] as unknown as { max_values: number };
    expect(selectData.max_values).toBe(5);
  });

  it('reports expiry when the session is gone', async () => {
    sessionManagerMock.findByMessageId.mockResolvedValue(null);
    const interaction = createButtonInteraction({});

    await handleMemoryBatchSelectEntry(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('surfaces a transient error when the page fetch fails', async () => {
    mockFetchMemories.mockResolvedValue(null);
    const interaction = createButtonInteraction({});

    await handleMemoryBatchSelectEntry(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Couldn't load that page"),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('renders the emptied page as the list embed plus a Cancel-only component set', async () => {
    mockFetchMemories.mockResolvedValue(browseResponse([]));
    const interaction = createButtonInteraction({});

    await handleMemoryBatchSelectEntry(interaction);

    expect(interaction.followUp).not.toHaveBeenCalled();
    const rows = editReplyComponentRows(interaction);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(1);
    expect(rows[0][0]).toMatchObject({
      custom_id: 'memory-detail::batch-cancel',
      label: 'Cancel',
    });
  });
});

describe('handleMemoryBatchPick (confirm view)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acks first, lists every selected memory, and parses the footer back to exactly the picked ids', async () => {
    const swappedRows = buildMemoryBatchSelectComponents(BROWSE_SESSION.data, MEMORIES, 0);
    const interaction = createSelectInteraction(['mem-2', 'mem-4'], swappedRows);

    await handleMemoryBatchPick(interaction);

    const deferOrder = vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0];
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(deferOrder).toBeLessThan(vi.mocked(interaction.editReply).mock.invocationCallOrder[0]);

    const [embed] = editReplyEmbeds(interaction);
    expect(embed.description).toContain('Content of mem-2');
    expect(embed.description).toContain('Content of mem-4');
    expect(embed.description).not.toContain('Content of mem-1');
    expect(embed.footer?.text.split('\n')).toEqual(['mem-2', 'mem-4']);
  });

  it('offers Lock (Secondary) and Delete (Danger, last) plus Cancel', async () => {
    const swappedRows = buildMemoryBatchSelectComponents(BROWSE_SESSION.data, MEMORIES, 0);
    const interaction = createSelectInteraction(['mem-2', 'mem-4'], swappedRows);

    await handleMemoryBatchPick(interaction);

    const rows = editReplyComponentRows(interaction);
    expect(rows).toHaveLength(2);

    const [lockRow, confirmRow] = rows;
    const lock = lockRow[0] as { custom_id?: string; label?: string; style?: number };
    expect(lock.custom_id).toBe('memory-detail::batch-confirm::lock');
    expect(lock.label).toBe('Lock (2)');
    expect(lock.style).toBe(ButtonStyle.Secondary);

    const [, del] = confirmRow as { label?: string; style?: number; custom_id?: string }[];
    expect(confirmRow[0].label).toBe('Cancel');
    expect(del.custom_id).toBe('memory-detail::batch-confirm::delete');
    expect(del.label).toBe('Delete (2)');
    expect(del.style).toBe(ButtonStyle.Danger);
  });

  it('keeps the warning whole when the listing is long (clamp the listing, not the warning)', async () => {
    const longMemories = MEMORY_IDS.map(id =>
      createMockMemory(id, { content: `Content of ${id}: ${'x'.repeat(900)}` })
    );
    const swappedRows = buildMemoryBatchSelectComponents(BROWSE_SESSION.data, longMemories, 0);
    const interaction = createSelectInteraction(MEMORY_IDS, swappedRows);

    await handleMemoryBatchPick(interaction);

    const [embed] = editReplyEmbeds(interaction);
    expect(
      embed.description?.endsWith('Delete is permanent — a deleted memory cannot be recovered.')
    ).toBe(true);
  });

  it('asks for a retry when no usable values arrived', async () => {
    const interaction = createSelectInteraction(
      [],
      buildMemoryBatchSelectComponents(BROWSE_SESSION.data, MEMORIES, 0)
    );

    await handleMemoryBatchPick(interaction);

    expect(interaction.followUp).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('strips the leading menu display number from a select option label in the confirm listing', async () => {
    const numberedRow = {
      toJSON: () => ({
        type: 1,
        components: [
          {
            type: 3,
            options: [{ value: 'mem-2', label: '3. Content of mem-2' }],
          },
        ],
      }),
    };
    const interaction = createSelectInteraction(['mem-2'], [numberedRow as never]);

    await handleMemoryBatchPick(interaction);

    const [embed] = editReplyEmbeds(interaction);
    expect(embed.description).toContain('• Content of mem-2');
    expect(embed.description).not.toContain('• 3. ');
  });

  it('propagates an editReply failure to the central handler instead of swallowing it', async () => {
    const swappedRows = buildMemoryBatchSelectComponents(BROWSE_SESSION.data, MEMORIES, 0);
    const interaction = createSelectInteraction(['mem-2', 'mem-4'], swappedRows);
    vi.mocked(interaction.editReply).mockRejectedValueOnce(new Error('editReply failed'));

    await expect(handleMemoryBatchPick(interaction)).rejects.toThrow('editReply failed');
    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(interaction.editReply).mock.invocationCallOrder[0]
    );
    expect(interaction.followUp).not.toHaveBeenCalled();
  });
});
