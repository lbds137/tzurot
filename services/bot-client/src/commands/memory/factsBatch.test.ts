/**
 * Tests for the memory facts batch flow ("Select several").
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonStyle, MessageFlags } from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';

import {
  buildBatchSelectComponents,
  handleBatchSelectEntry,
  handleBatchPick,
  handleBatchConfirm,
} from './factsBatch.js';
import { buildFactActionId } from './factsDetail.js';
import { FACTS_SESSION_EXPIRED } from './factsBrowse.js';
import { encodeBatchFooterIds } from '../../utils/browse/multiSelectBatch.js';
import type { FactItem } from './factsApi.js';
import { makeOk, makeErr, asUserClient } from '../../test/gatewayClientStubs.js';

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
  set: vi.fn().mockResolvedValue(undefined),
  get: vi.fn(),
  update: vi.fn().mockResolvedValue(undefined),
  findByMessageId: vi.fn(),
}));
vi.mock('../../utils/dashboard/index.js', () => ({
  getSessionManager: () => sessionManagerMock,
}));

interface FactClientStub {
  listFacts: ReturnType<typeof vi.fn>;
  forgetFact: ReturnType<typeof vi.fn>;
  setFactLock: ReturnType<typeof vi.fn>;
}

function createStub(): FactClientStub {
  return { listFacts: vi.fn(), forgetFact: vi.fn(), setFactLock: vi.fn() };
}

const FACT_IDS = ['fact-1', 'fact-2', 'fact-3', 'fact-4', 'fact-5'];

const createMockFact = (id: string, overrides: Partial<FactItem> = {}): FactItem => ({
  id,
  personalityId: 'personality-456',
  personaId: 'persona-789',
  statement: `Statement of ${id}`,
  entityTags: ['user'],
  salience: 0.7,
  tier: 'observed',
  isLocked: false,
  validFrom: '2026-06-15T12:00:00.000Z',
  supersededAt: null,
  supersededById: null,
  forgotten: false,
  sourceMemoryIds: [],
  createdAt: '2026-06-15T12:00:00.000Z',
  ...overrides,
});

const FACTS = FACT_IDS.map(id => createMockFact(id));

function listResponse(facts: FactItem[], total = facts.length) {
  return makeOk({ facts, total, limit: 10, offset: 0, hasMore: false });
}

function createButtonInteraction(options: {
  messageEmbedFooter?: string;
  deferred?: boolean;
}): ButtonInteraction {
  return {
    user: { id: 'user-1' },
    customId: buildFactActionId('batch-confirm', 'forget'),
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
    customId: buildFactActionId('batch-select'),
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

/**
 * The mocked interaction's LAST editReply payload (unknown-typed mocks) —
 * the confirm flow edits several times (component strip, then the result
 * reply), so the result assertions read the final call.
 */
function editReplyPayload(interaction: unknown): EditReplyPayload {
  const calls = (interaction as { editReply: { mock: { calls: unknown[][] } } }).editReply.mock
    .calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as EditReplyPayload;
}

/**
 * editReply receives EmbedBuilder instances (which carry their payload under
 * `.data`) or the test's plain mock embeds — normalize both.
 */
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

describe('buildBatchSelectComponents (the multi-select swap)', () => {
  it('replaces the single-select with a real multi-select: min 1, max capped at the item count', () => {
    // 5 items on the page — maxValues is FACTS_PER_PAGE (10), the factory caps at 5.
    const rows = buildBatchSelectComponents(FACTS, 0);
    const selectData = rows[0].toJSON().components[0] as unknown as Record<string, unknown> & {
      custom_id: string;
      min_values: number;
      max_values: number;
      options: { value: string }[];
    };
    expect(selectData.custom_id).toBe(buildFactActionId('batch-select'));
    expect(selectData.min_values).toBe(1);
    expect(selectData.max_values).toBe(5);
    expect(selectData.options.map(o => o.value)).toEqual(FACT_IDS);
  });

  it('keeps a Cancel affordance', () => {
    const rows = buildBatchSelectComponents(FACTS, 0);
    const allButtons = rows.flatMap(
      row => row.toJSON().components as unknown as Record<string, unknown>[]
    );
    const cancel = allButtons.find(
      button => button.custom_id === buildFactActionId('batch-cancel')
    );
    expect(cancel).toBeDefined();
    expect(cancel?.label).toBe('Cancel');
  });

  it('renders exactly the select row plus a Cancel row — NO pagination buttons', () => {
    // Batch mode serves one page; pagination customIds route to the
    // single-select render and would silently exit batch mode.
    const rows = buildBatchSelectComponents(FACTS, 0);
    expect(rows).toHaveLength(2);

    const [selectRow, cancelRow] = rows.map(row => row.toJSON().components);
    expect(selectRow).toHaveLength(1);
    expect((selectRow[0] as { custom_id?: string }).custom_id).toBe(
      buildFactActionId('batch-select')
    );
    // The second row is one Cancel button — nothing else, no pagination.
    expect(cancelRow).toHaveLength(1);
    expect(cancelRow[0]).toMatchObject({
      custom_id: buildFactActionId('batch-cancel'),
      label: 'Cancel',
    });
  });
});

describe('handleBatchSelectEntry', () => {
  let stub: FactClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0 },
    });
  });

  it('acks FIRST, then re-fetches the page and renders the multi-select swap', async () => {
    stub.listFacts.mockResolvedValue(listResponse(FACTS));
    const interaction = createButtonInteraction({});

    await handleBatchSelectEntry(interaction);

    const deferOrder = vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0];
    const fetchOrder = stub.listFacts.mock.invocationCallOrder[0];
    expect(deferOrder).toBeLessThan(fetchOrder);
    expect(interaction.editReply).toHaveBeenCalled();

    const rows = editReplyComponentRows(interaction);
    const selectData = rows[0][0] as unknown as { max_values: number };
    expect(selectData.max_values).toBe(5);
  });

  it('reports expiry when the session is gone', async () => {
    sessionManagerMock.findByMessageId.mockResolvedValue(null);
    const interaction = createButtonInteraction({});

    await handleBatchSelectEntry(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining('expired') })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('surfaces a transient error when the page fetch fails', async () => {
    stub.listFacts.mockResolvedValue(makeErr(500, 'boom'));
    const interaction = createButtonInteraction({});

    await handleBatchSelectEntry(interaction);

    expect(interaction.followUp).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('renders the emptied page as the list embed plus a Cancel-only component set', async () => {
    // Every fact on the page is gone: buildBrowseSelectMenu returns null on
    // the empty page, so the multi-select swap is just the Cancel row — and
    // the entry must not throw on it.
    stub.listFacts.mockResolvedValue(listResponse([]));
    const interaction = createButtonInteraction({});

    await handleBatchSelectEntry(interaction);

    expect(interaction.followUp).not.toHaveBeenCalled();
    const embeds = editReplyEmbeds(interaction);
    expect(embeds).toHaveLength(1);

    const rows = editReplyComponentRows(interaction);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveLength(1);
    expect(rows[0][0]).toMatchObject({
      custom_id: buildFactActionId('batch-cancel'),
      label: 'Cancel',
    });
  });
});

describe('handleBatchPick (confirm view)', () => {
  let stub: FactClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  it('acks first, lists every selected item, and parses the footer back to exactly the picked ids', async () => {
    // The multi-select row is still attached to the message the pick fired on.
    const swappedRows = buildBatchSelectComponents(FACTS, 0);
    const interaction = createSelectInteraction(['fact-2', 'fact-4'], swappedRows);

    await handleBatchPick(interaction);

    const deferOrder = vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0];
    expect(interaction.deferUpdate).toHaveBeenCalled();
    expect(deferOrder).toBeLessThan(vi.mocked(interaction.editReply).mock.invocationCallOrder[0]);

    const [embed] = editReplyEmbeds(interaction);
    // The confirm embed lists EVERY selected item (statement + lock badge live
    // in the option labels) — read back off the still-attached menu row.
    expect(embed.description).toContain('Statement of fact-2');
    expect(embed.description).toContain('Statement of fact-4');
    expect(embed.description).not.toContain('Statement of fact-1');
    expect(parseBatchFooterForTest(embed)).toEqual(['fact-2', 'fact-4']);
  });

  it('offers Lock (Secondary) and Forget (Danger, last) plus Cancel', async () => {
    const swappedRows = buildBatchSelectComponents(FACTS, 0);
    const interaction = createSelectInteraction(['fact-2', 'fact-4'], swappedRows);

    await handleBatchPick(interaction);

    const rows = editReplyComponentRows(interaction);
    expect(rows).toHaveLength(2);

    const [lockRow, confirmRow] = rows;
    const lock = lockRow[0] as { custom_id?: string; label?: string; style?: number };
    expect(lock.custom_id).toBe(buildFactActionId('batch-confirm', 'lock'));
    expect(lock.label).toBe('Lock (2)');
    expect(lock.style).toBe(ButtonStyle.Secondary);

    const [, forget] = confirmRow as {
      label?: string;
      style?: number;
      custom_id?: string;
    }[];
    expect(confirmRow[0].label).toBe('Cancel');
    expect(forget.custom_id).toBe(buildFactActionId('batch-confirm', 'forget'));
    expect(forget.label).toBe('Forget (2)');
    expect(forget.style).toBe(ButtonStyle.Danger);
  });

  it('asks for a retry when no usable values arrived', async () => {
    const interaction = createSelectInteraction([], buildBatchSelectComponents(FACTS, 0));

    await handleBatchPick(interaction);

    expect(interaction.followUp).toHaveBeenCalled();
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('survives malformed component JSON: skips non-object options, degrades a non-string label to the value', async () => {
    // discord.js rehydrates components as builders, so the walker reads
    // row.toJSON() output as unknown data — malformed payloads must not throw.
    const malformedRow = {
      toJSON: () => ({
        type: 1,
        components: [
          {
            type: 3,
            options: [
              'garbage',
              { value: 'fact-2', label: 'Label from JSON' },
              { value: 'fact-9', label: 42 },
            ],
          },
        ],
      }),
    };
    const interaction = createSelectInteraction(['fact-2', 'fact-9'], [malformedRow as never]);

    await handleBatchPick(interaction);

    const [embed] = editReplyEmbeds(interaction);
    expect(embed.description).toContain('Label from JSON');
    expect(embed.description).toContain('fact-9');
  });
});

function parseBatchFooterForTest(embed: EmbedData): string[] | null {
  if (embed.footer === undefined) {
    return null;
  }
  return embed.footer.text.split('\n');
}

describe('handleBatchConfirm — forget', () => {
  let stub: FactClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0 },
    });
    stub.listFacts.mockResolvedValue(listResponse(FACTS));
  });

  it('strips the confirm components BEFORE the first fetch and the loop', async () => {
    // The buttons are gone before ANY await that could overlap a second
    // interaction — including the pre-loop label fetch — so no second confirm
    // run can start (double-tap re-runs, Lock+Forget interleave, Cancel
    // overwritten). The FIRST editReply must clear them before the first
    // listFacts call AND the first mutation call.
    stub.forgetFact.mockResolvedValue(makeOk({ id: 'fact-1', forgotten: true }));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1']),
    });

    await handleBatchConfirm(interaction, 'forget');

    const firstEdit = vi.mocked(interaction.editReply).mock.calls[0]?.[0] as EditReplyPayload;
    expect(firstEdit).toEqual({ components: [] });
    const stripOrder = vi.mocked(interaction.editReply).mock.invocationCallOrder[0];
    expect(stripOrder).toBeLessThan(stub.listFacts.mock.invocationCallOrder[0]);
    const firstMutationOrder = stub.forgetFact.mock.invocationCallOrder[0];
    expect(stripOrder).toBeLessThan(firstMutationOrder);
  });

  it('names the failures AND the successes, and reaches every id (C1, partial failure)', async () => {
    // F2 fails MID-LIST; F1 and F3-F5 must still be attempted and named.
    stub.forgetFact.mockImplementation((factId: string) =>
      Promise.resolve(
        factId === 'fact-2'
          ? makeErr(500, 'internal error')
          : makeOk({ id: factId, forgotten: true })
      )
    );
    // The page fetch models a REAL deletion: the PRE-LOOP call (result-time
    // labels) sees the full page; the POST-LOOP refresh sees only fact-2 —
    // the four forgotten facts are gone. A success line can therefore only
    // carry its real statement if the labels were resolved before the loop.
    let listCalls = 0;
    stub.listFacts.mockImplementation(() => {
      listCalls += 1;
      return Promise.resolve(
        listCalls === 1 ? listResponse(FACTS) : listResponse([createMockFact('fact-2')])
      );
    });
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(FACT_IDS),
    });

    await handleBatchConfirm(interaction, 'forget');

    // The loop reached ALL five ids — one failure never stops the run.
    // (The stub is the gateway client: factsApi.forgetFact forwards only the
    // factId; userId is used for logging inside the api wrapper.)
    expect(stub.forgetFact).toHaveBeenCalledTimes(5);
    for (const id of FACT_IDS) {
      expect(stub.forgetFact).toHaveBeenCalledWith(id);
    }

    // Exactly two purposeful fetches: pre-loop labels, post-loop refreshed view.
    expect(listCalls).toBe(2);

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.title).toContain('Forget');
    expect(resultEmbed.description).toContain('✅ Statement of fact-1');
    // A success AFTER the failed item — the run continued past the failure.
    expect(resultEmbed.description).toContain('✅ Statement of fact-4');
    expect(resultEmbed.description).toContain('❌ Statement of fact-2');

    // The list refresh rode the same reply (result embed on top, list under it).
    const embeds = editReplyEmbeds(interaction);
    expect(embeds).toHaveLength(2);
    expect(editReplyComponentRows(interaction).length).toBeGreaterThan(0);
  });

  it('retries the reply with the result embed alone when the stacked editReply rejects', async () => {
    stub.forgetFact.mockResolvedValue(makeOk({ id: 'fact-1', forgotten: true }));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1']),
    });
    // Call 1 is the pre-loop component strip (resolves); call 2 is the stacked
    // result reply (rejects); call 3 falls through to the default resolve.
    vi.mocked(interaction.editReply)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('Invalid Form Body'));

    await handleBatchConfirm(interaction, 'forget');

    // The loop ran to completion BEFORE the reply was attempted.
    expect(stub.forgetFact).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledTimes(3);
    const fallback = (vi.mocked(interaction.editReply).mock.calls[2]?.[0] ??
      {}) as EditReplyPayload;
    expect(fallback.embeds).toHaveLength(1);
    expect(fallback.components).toEqual([]);
  });

  it('falls back to a plain ephemeral followUp with the counts when BOTH editReply attempts reject', async () => {
    stub.forgetFact.mockResolvedValue(makeOk({ id: 'fact-1', forgotten: true }));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1']),
    });
    // Strip resolves; the stacked result reply AND the result-only retry both
    // reject — the summary must still reach the user via followUp.
    vi.mocked(interaction.editReply)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('Invalid Form Body'))
      .mockRejectedValueOnce(new Error('Unknown Message'));

    await handleBatchConfirm(interaction, 'forget');

    expect(stub.forgetFact).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledTimes(3);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('1 succeeded'),
        flags: MessageFlags.Ephemeral,
      })
    );
  });

  it('falls back to the counts followUp when the view is null AND the result-only editReply rejects', async () => {
    // Post-loop refresh fails (second list call) → view null → the result
    // reply is a result-only editReply, but it is STILL laddered: if that
    // rejects too (message deleted mid-run), the mutations have already run,
    // so the ephemeral counts followUp must carry the report — the error must
    // NOT propagate and lose it.
    stub.forgetFact.mockResolvedValue(makeOk({ id: 'fact-1', forgotten: true }));
    let listCalls = 0;
    stub.listFacts.mockImplementation(() => {
      listCalls += 1;
      return listCalls === 1
        ? Promise.resolve(listResponse(FACTS))
        : Promise.resolve(makeErr(500, 'refresh failed'));
    });
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1']),
    });
    vi.mocked(interaction.editReply)
      .mockResolvedValueOnce(undefined as never) // the pre-loop component strip
      .mockRejectedValueOnce(new Error('Invalid Form Body')); // the result-only reply

    await expect(handleBatchConfirm(interaction, 'forget')).resolves.toBeUndefined();
    expect(interaction.editReply).toHaveBeenCalledTimes(2);
    const resultReply = vi.mocked(interaction.editReply).mock.calls[1]?.[0] as EditReplyPayload;
    expect(resultReply.embeds).toHaveLength(1);
    expect(resultReply.components).toEqual([]);
    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('1 succeeded'),
        flags: MessageFlags.Ephemeral,
      })
    );
  });

  it('survives a throwing refreshed-view round-trip after the mutations ran (survival ladder)', async () => {
    // buildRefreshedFactsView does session-manager round-trips that can throw
    // AFTER the forget ran — the throw must degrade to the result-only reply,
    // never propagate and lose the report.
    stub.forgetFact.mockResolvedValue(makeOk({ id: 'fact-1', forgotten: true }));
    // Call 1 is the pre-loop label resolution's session lookup (resolves);
    // call 2 is the refreshed view's session round-trip (throws).
    sessionManagerMock.findByMessageId
      .mockResolvedValueOnce({ data: { personalityId: 'personality-456', currentPage: 0 } })
      .mockRejectedValueOnce(new Error('session manager down'));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1']),
    });

    await expect(handleBatchConfirm(interaction, 'forget')).resolves.toBeUndefined();

    expect(stub.forgetFact).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).toHaveBeenCalledTimes(2);
    const resultReply = vi.mocked(interaction.editReply).mock.calls[1]?.[0] as EditReplyPayload;
    expect(resultReply.embeds).toHaveLength(1);
    expect(resultReply.components).toEqual([]);
  });

  it('keeps the stacked reply within the 6000-char embed budget for long statements', async () => {
    // ~200-char statements: the pre-fix code stacked FULL statements into the
    // result lines on top of the list embed and could pass Discord's
    // per-message sum of embed text.
    const longFacts = FACT_IDS.map(id =>
      createMockFact(id, { statement: `Statement of ${id}: ${'x'.repeat(200)}` })
    );
    stub.listFacts.mockResolvedValue(listResponse(longFacts));
    stub.forgetFact.mockImplementation((factId: string) =>
      Promise.resolve(
        factId === 'fact-2'
          ? makeErr(500, 'internal error')
          : makeOk({ id: factId, forgotten: true })
      )
    );
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(FACT_IDS),
    });

    await handleBatchConfirm(interaction, 'forget');

    const embeds = editReplyEmbeds(interaction);
    expect(embeds).toHaveLength(2);
    const budget = embeds.reduce(
      (total, embed) =>
        total +
        (embed.title?.length ?? 0) +
        (embed.description?.length ?? 0) +
        (embed.footer?.text.length ?? 0),
      0
    );
    expect(budget).toBeLessThanOrEqual(6000);
    for (const embed of embeds) {
      expect(embed.description?.length ?? 0).toBeLessThanOrEqual(3800);
    }
  });

  it('renders an already-gone 404 as its own outcome, not an error', async () => {
    stub.forgetFact.mockResolvedValue(makeErr(404, 'gone'));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1']),
    });

    await handleBatchConfirm(interaction, 'forget');

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('◻️');
    expect(resultEmbed.description).toContain('already gone');
    expect(resultEmbed.description).not.toContain('❌');
    // Nothing succeeded and nothing failed — no work was done: warning amber.
    expect(resultEmbed.color).toBe(DISCORD_COLORS.WARNING);
  });

  it('renders a thrown failure with the classified reason', async () => {
    // 500 (not 403): a forget 403 is the locked-fact rejection and renders as
    // the locked outcome — this test pins the generic classified-failure path.
    stub.forgetFact.mockResolvedValue(makeErr(500, 'internal error'));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-2']),
    });

    await handleBatchConfirm(interaction, 'forget');

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('❌');
  });

  it('refuses with the transient copy, before any mutation, when the pre-loop page fetch fails', async () => {
    // The session lives, but its page fetch failed — the run must not mutate
    // on an unloadable page, and must NOT read as an expired session. The
    // strip editReply has already run (the confirm view is inert); the refusal
    // loses only that inert view — the copy rides the ephemeral followUp.
    stub.listFacts.mockResolvedValue(makeErr(500, 'boom'));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1']),
    });

    await handleBatchConfirm(interaction, 'forget');

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({ content: expect.stringContaining("Couldn't load that page") })
    );
    expect(stub.forgetFact).not.toHaveBeenCalled();
    expect(stub.setFactLock).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(interaction.editReply).mock.calls[0]?.[0]).toEqual({ components: [] });
  });

  it('refuses with the expiry message BEFORE mutating when the list session is gone', async () => {
    sessionManagerMock.findByMessageId.mockResolvedValue(null);
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1']),
    });

    await handleBatchConfirm(interaction, 'forget');

    expect(interaction.followUp).toHaveBeenCalledWith({
      content: FACTS_SESSION_EXPIRED,
      flags: MessageFlags.Ephemeral,
    });
    expect(stub.forgetFact).not.toHaveBeenCalled();
    expect(stub.setFactLock).not.toHaveBeenCalled();
    // The strip already ran (before the session lookup); the refusal loses
    // only the inert confirm view.
    expect(interaction.editReply).toHaveBeenCalledTimes(1);
    expect(vi.mocked(interaction.editReply).mock.calls[0]?.[0]).toEqual({ components: [] });
  });

  it('skips the ack when the router already deferred', async () => {
    stub.forgetFact.mockResolvedValue(makeOk({ id: 'fact-1', forgotten: true }));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1']),
      deferred: true,
    });

    await handleBatchConfirm(interaction, 'forget');

    expect(interaction.deferUpdate).not.toHaveBeenCalled();
  });
});

describe('handleBatchConfirm — guard rails', () => {
  let stub: FactClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
  });

  it('asks for a retry when the footer carries no ids (expired/tampered view)', async () => {
    const interaction = createButtonInteraction({});

    await handleBatchConfirm(interaction, 'forget');

    expect(interaction.followUp).toHaveBeenCalled();
    expect(stub.forgetFact).not.toHaveBeenCalled();
    expect(stub.setFactLock).not.toHaveBeenCalled();
  });
});

describe('handleBatchConfirm — lock', () => {
  let stub: FactClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0 },
    });
    stub.listFacts.mockResolvedValue(listResponse(FACTS));
    stub.setFactLock.mockImplementation((factId: string) =>
      Promise.resolve(makeOk({ fact: createMockFact(factId, { isLocked: true }) }))
    );
  });

  it('locks every selected fact with the explicit target state, SUCCESS color on an all-success run', async () => {
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1', 'fact-3']),
    });

    await handleBatchConfirm(interaction, 'lock');

    expect(stub.setFactLock).toHaveBeenCalledWith('fact-1', { locked: true });
    expect(stub.setFactLock).toHaveBeenCalledWith('fact-3', { locked: true });

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.title).toContain('Lock');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.SUCCESS);
    expect(resultEmbed.description).toContain('✅ Statement of fact-1');
    expect(resultEmbed.description).toContain('✅ Statement of fact-3');
  });

  it('renders the ERROR color when any item of the run fails', async () => {
    stub.setFactLock.mockImplementation((factId: string) =>
      Promise.resolve(
        factId === 'fact-2'
          ? makeErr(403, 'Cannot lock a forgotten fact')
          : makeOk({ fact: createMockFact(factId, { isLocked: true }) })
      )
    );
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1', 'fact-2']),
    });

    await handleBatchConfirm(interaction, 'lock');

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.title).toContain('Lock');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
    expect(resultEmbed.description).toContain('✅ Statement of fact-1');
    expect(resultEmbed.description).toContain('❌ Statement of fact-2');
  });

  it('skips already-locked facts as their own outcome and locks only the unlocked', async () => {
    // An already-locked fact's target state is already set, so it never
    // reaches the gateway — mirrored by the forget run's locked skip.
    const mixed = [
      createMockFact('fact-1', { isLocked: true }),
      createMockFact('fact-2'),
      createMockFact('fact-3', { isLocked: true }),
    ];
    stub.listFacts.mockResolvedValue(listResponse(mixed));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1', 'fact-2', 'fact-3']),
    });

    await handleBatchConfirm(interaction, 'lock');

    expect(stub.setFactLock).toHaveBeenCalledTimes(1);
    expect(stub.setFactLock).toHaveBeenCalledWith('fact-2', { locked: true });

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('🔐 Statement of fact-1 — already locked');
    expect(resultEmbed.description).toContain('🔐 Statement of fact-3 — already locked');
    expect(resultEmbed.description).toContain('✅ Statement of fact-2');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.SUCCESS);
  });
});

describe('handleBatchConfirm — locked facts in a forget run', () => {
  let stub: FactClientStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ userClient: asUserClient(stub) });
    sessionManagerMock.findByMessageId.mockResolvedValue({
      data: { personalityId: 'personality-456', currentPage: 0 },
    });
  });

  it('skips locked facts upfront with their own outcome and forgets the rest', async () => {
    const mixed = [
      createMockFact('fact-1', { isLocked: true }),
      ...FACT_IDS.slice(1).map(id => createMockFact(id)),
    ];
    stub.listFacts.mockResolvedValue(listResponse(mixed));
    stub.forgetFact.mockImplementation((factId: string) =>
      Promise.resolve(makeOk({ id: factId, forgotten: true }))
    );
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(FACT_IDS),
    });

    await handleBatchConfirm(interaction, 'forget');

    // The locked id never reaches the gateway (it would 403); the rest run.
    expect(stub.forgetFact).toHaveBeenCalledTimes(4);
    expect(stub.forgetFact).not.toHaveBeenCalledWith('fact-1');
    for (const id of FACT_IDS.slice(1)) {
      expect(stub.forgetFact).toHaveBeenCalledWith(id);
    }

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('🔐');
    expect(resultEmbed.description).toContain('locked — unlock first');
    expect(resultEmbed.description).toContain('✅ Statement of fact-2');
    // A deliberate lock skip is NOT a failure — the run stays green.
    expect(resultEmbed.color).toBe(DISCORD_COLORS.SUCCESS);
  });

  it('makes no gateway mutation calls when every picked fact is locked', async () => {
    stub.listFacts.mockResolvedValue(
      listResponse(FACT_IDS.map(id => createMockFact(id, { isLocked: true })))
    );
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(FACT_IDS),
    });

    await handleBatchConfirm(interaction, 'forget');

    expect(stub.forgetFact).not.toHaveBeenCalled();
    expect(stub.setFactLock).not.toHaveBeenCalled();

    const [resultEmbed] = editReplyEmbeds(interaction);
    const description = resultEmbed.description ?? '';
    expect(description.match(/locked — unlock first/g)).toHaveLength(FACT_IDS.length);
    // An all-locked run did no work and failed none — warning, not green.
    expect(resultEmbed.color).toBe(DISCORD_COLORS.WARNING);
  });

  it('maps a forget 403 on an id missing from the fetched page to the locked outcome', async () => {
    // The fetch succeeded but fact-1 fell off the page — its lock state is
    // UNKNOWN from the page; the gateway 403s the forget (locked fact), which
    // is the only honest locked signal. Locked, not ❌, and the run stays green.
    stub.listFacts.mockResolvedValue(listResponse(FACTS.slice(1)));
    stub.forgetFact.mockResolvedValue(makeErr(403, 'Cannot forget a locked fact'));
    const interaction = createButtonInteraction({
      messageEmbedFooter: encodeBatchFooterIds(['fact-1']),
    });

    await handleBatchConfirm(interaction, 'forget');

    const [resultEmbed] = editReplyEmbeds(interaction);
    expect(resultEmbed.description).toContain('🔐');
    expect(resultEmbed.description).toContain('locked — unlock first');
    expect(resultEmbed.description).not.toContain('❌');
    // The only line is a locked skip: no work done, none failed — warning.
    expect(resultEmbed.color).toBe(DISCORD_COLORS.WARNING);
  });
});
