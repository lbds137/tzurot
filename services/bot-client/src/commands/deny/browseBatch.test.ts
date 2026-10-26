/**
 * Tests for the deny browse batch removal flow (browseBatch.ts).
 *
 * Covers Canaries C1–C7, Hardening 1–7, ack-first and component-strip-first
 * ordering, 4-tuple resolution, cancel, error paths, customId length ceiling,
 * and the survival ladder.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ButtonStyle,
  MessageFlags,
  type APIEmbed,
  type ButtonInteraction,
  type EmbedBuilder,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { DISCORD_COLORS, DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { DENYLIST_LIST_MAX_ENTRIES } from '@tzurot/common-types/schemas/api/denylist';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { makeOk, makeErr, asOwnerClient } from '../../test/gatewayClientStubs.js';
import {
  clampBatchConfirmDescription,
  encodeBatchFooterIds,
  LISTING_BULLET,
  PAGE_FETCH_FAILED_COPY,
  parseBatchFooterIds,
} from '../../utils/browse/multiSelectBatch.js';
import { DASHBOARD_MESSAGES } from '../../utils/dashboard/messages.js';
import {
  buildBrowseResponse,
  buildDenyBatchCustomId,
  formatDenySelectOption,
  handleBrowseSelect,
  type DenyBrowseFilter,
} from './browse.js';
import type { DenylistEntryResponse } from './browseTypes.js';
import {
  FAILED_TO_REMOVE_NOTE,
  buildRefreshedDenyBrowseView,
  fallbackDenyLabel,
  handleDenyBatchButton,
  handleDenyBatchCancel,
  handleDenyBatchConfirm,
  handleDenyBatchPick,
  handleDenyBatchSelectEntry,
  isDenyBatchButton,
  isDenyBatchSelect,
} from './browseBatch.js';

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: vi.fn(() => loggerMock),
  };
});

vi.mock('@tzurot/common-types/utils/ownerMiddleware', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/ownerMiddleware')>(
    '@tzurot/common-types/utils/ownerMiddleware'
  );
  return {
    ...actual,
    isBotOwner: vi.fn(),
  };
});

const clientsForMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/gatewayClients.js', () => ({
  clientsFor: clientsForMock,
}));

const showDetailViewMock = vi.hoisted(() => vi.fn());
vi.mock('./detail.js', () => ({
  showDetailView: showDetailViewMock,
}));

interface OwnerStub {
  listDenylistEntries: ReturnType<typeof vi.fn>;
  removeDenylistEntry: ReturnType<typeof vi.fn>;
}

function createStub(): OwnerStub {
  return {
    listDenylistEntries: vi.fn(),
    removeDenylistEntry: vi.fn(),
  };
}

const FIVE_DENY_ENTRIES = [
  {
    id: '11111111-1111-4111-8111-000000000001',
    type: 'USER',
    discordId: '111222333444555666',
    scope: 'BOT',
    scopeId: '*',
    mode: 'BLOCK',
    reason: 'Spamming across channels',
    addedAt: new Date('2026-01-15T00:00:00.000Z'),
    addedBy: 'owner-1',
  },
  {
    id: '22222222-2222-4222-8222-000000000002',
    type: 'GUILD',
    discordId: '999888777666555444',
    scope: 'BOT',
    scopeId: '*',
    mode: 'BLOCK',
    reason: null,
    addedAt: new Date('2026-01-14T00:00:00.000Z'),
    addedBy: 'owner-1',
  },
  {
    id: '33333333-3333-4333-8333-000000000003',
    type: 'USER',
    discordId: '555666777888999000',
    scope: 'CHANNEL',
    scopeId: '123456789012345678',
    mode: 'MUTE',
    reason: 'Abusive behavior',
    addedAt: new Date('2026-01-13T00:00:00.000Z'),
    addedBy: 'owner-1',
  },
  {
    id: '44444444-4444-4444-8444-000000000004',
    type: 'USER',
    discordId: '444333222111000999',
    scope: 'GUILD',
    scopeId: '876543210987654321',
    mode: 'BLOCK',
    reason: 'Sensitive reason text that must never be logged',
    addedAt: new Date('2026-01-12T00:00:00.000Z'),
    addedBy: 'owner-1',
  },
  {
    id: '55555555-5555-4555-8555-000000000005',
    type: 'USER',
    discordId: '777888999000111222',
    scope: 'PERSONALITY',
    scopeId: 'char-uuid-9999',
    mode: 'MUTE',
    reason: 'Repeatedly testing boundaries',
    addedAt: new Date('2026-01-11T00:00:00.000Z'),
    addedBy: 'owner-1',
  },
] satisfies DenylistEntryResponse[];

function buildDenyEntries(count: number): DenylistEntryResponse[] {
  return Array.from({ length: count }, (_, idx) => ({
    ...FIVE_DENY_ENTRIES[0],
    id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
    discordId: `100000000000${String(idx + 1).padStart(6, '0')}`,
  }));
}

function createButtonInteraction(options: {
  customId: string;
  userId?: string;
  footerText?: string;
  description?: string;
  messageComponents?: unknown[];
  deferred?: boolean;
  replied?: boolean;
}): ButtonInteraction {
  const embeds =
    options.footerText !== undefined || options.description !== undefined
      ? [
          {
            description: options.description,
            footer: options.footerText !== undefined ? { text: options.footerText } : undefined,
          },
        ]
      : [];
  return {
    user: { id: options.userId ?? 'owner-1' },
    customId: options.customId,
    deferred: options.deferred ?? false,
    replied: options.replied ?? false,
    message: {
      id: 'msg-1',
      embeds,
      components: options.messageComponents ?? [],
    },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as ButtonInteraction;
}

function createSelectInteraction(options: {
  customId: string;
  values: string[];
  userId?: string;
  messageComponents?: unknown[];
  deferred?: boolean;
}): StringSelectMenuInteraction {
  return {
    user: { id: options.userId ?? 'owner-1' },
    customId: options.customId,
    values: options.values,
    channelId: 'chan-1',
    guildId: 'guild-456',
    deferred: options.deferred ?? false,
    replied: false,
    message: {
      id: 'msg-1',
      components: options.messageComponents ?? [],
    },
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as StringSelectMenuInteraction;
}

function lastEditReplyPayload(interaction: { editReply: unknown }): {
  content?: string;
  embeds?: EmbedBuilder[];
  components?: { toJSON: () => { components: Record<string, unknown>[] } }[];
} {
  const calls = vi.mocked(interaction.editReply as ReturnType<typeof vi.fn>).mock.calls;
  return (calls[calls.length - 1]?.[0] ?? {}) as {
    content?: string;
    embeds?: EmbedBuilder[];
    components?: { toJSON: () => { components: Record<string, unknown>[] } }[];
  };
}

function lastEmbedsJson(interaction: { editReply: unknown }): APIEmbed[] {
  return (lastEditReplyPayload(interaction).embeds ?? []).map(embed => embed.toJSON());
}

function lastComponentRows(interaction: { editReply: unknown }): Record<string, unknown>[][] {
  return (lastEditReplyPayload(interaction).components ?? []).map(row => row.toJSON().components);
}

describe('deny browse batch removal flow', () => {
  let stub: OwnerStub;

  beforeEach(() => {
    vi.clearAllMocks();
    stub = createStub();
    clientsForMock.mockReturnValue({ ownerClient: asOwnerClient(stub) });
    vi.mocked(isBotOwner).mockReturnValue(true);
  });

  describe('C3 — real multi-select swap render & handleDenyBatchSelectEntry', () => {
    it('renders a real multi-select with min 1, max = page item count, batch customId carrying page/filter/sort, Cancel button, and NO pagination row (C3)', () => {
      const view = buildBrowseResponse(FIVE_DENY_ENTRIES, 0, 'all', 'date', { mode: 'batch' });

      expect(view.components).toHaveLength(2);
      const [selectRow, cancelRow] = view.components.map(row => row.toJSON().components);

      expect(selectRow).toHaveLength(1);
      const selectMenu = selectRow[0] as unknown as {
        custom_id: string;
        min_values: number;
        max_values: number;
        options: { value: string; label: string; description?: string }[];
      };
      expect(selectMenu.custom_id).toBe('deny::batch-select::0::all::date');
      expect(selectMenu.min_values).toBe(1);
      expect(selectMenu.max_values).toBe(5);
      expect(selectMenu.options.map(o => o.value)).toEqual(FIVE_DENY_ENTRIES.map(e => e.id));

      expect(cancelRow).toHaveLength(1);
      expect(cancelRow[0]).toMatchObject({
        custom_id: 'deny::batch-cancel::0::all::date',
        label: 'Cancel',
      });

      const footerText = view.embed.toJSON().footer?.text ?? '';
      expect(footerText).toContain('Select several below, then confirm');

      const singleView = buildBrowseResponse(FIVE_DENY_ENTRIES, 0, 'all', 'date');
      expect(singleView.embed.toJSON().footer?.text ?? '').not.toContain(
        'Select several below, then confirm'
      );
    });

    it('acks first, fetches entries, and swaps the view into multi-select mode on batch-select click', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: FIVE_DENY_ENTRIES }));
      const interaction = createButtonInteraction({
        customId: 'deny::batch-select::0::user::name',
      });

      await handleDenyBatchSelectEntry(interaction);

      const deferOrder = vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0];
      const listOrder = stub.listDenylistEntries.mock.invocationCallOrder[0];
      expect(deferOrder).toBeLessThan(listOrder);

      const rows = lastComponentRows(interaction);
      expect(rows).toHaveLength(2);
      // 4 of the 5 entries have type USER
      expect(rows[0][0]).toMatchObject({
        custom_id: 'deny::batch-select::0::user::name',
        min_values: 1,
        max_values: 4,
      });
      expect(rows[1][0]).toMatchObject({
        custom_id: 'deny::batch-cancel::0::user::name',
        label: 'Cancel',
      });
    });

    it('surfaces PAGE_FETCH_FAILED_COPY on an ephemeral followUp when fetchEntries returns null on batch-select entry', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeErr(500, 'Internal error'));
      const interaction = createButtonInteraction({
        customId: 'deny::batch-select::0::all::date',
      });

      await handleDenyBatchSelectEntry(interaction);

      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(PAGE_FETCH_FAILED_COPY),
          flags: MessageFlags.Ephemeral,
        })
      );
    });
  });

  describe('handleDenyBatchPick (confirm view)', () => {
    it('acks first, reads option labels from the attached select menu, and renders Remove (N) (Danger, last) + Cancel', async () => {
      const batchView = buildBrowseResponse(FIVE_DENY_ENTRIES, 0, 'all', 'date', {
        mode: 'batch',
      });
      const pickedIds = [FIVE_DENY_ENTRIES[0].id, FIVE_DENY_ENTRIES[2].id];
      const interaction = createSelectInteraction({
        customId: 'deny::batch-select::0::all::date',
        values: pickedIds,
        messageComponents: batchView.components,
      });

      await handleDenyBatchPick(interaction);

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      const [embed] = lastEmbedsJson(interaction);
      expect(embed.title).toContain('Remove Denylist Entries?');
      expect(embed.description).toContain('111222333444555666');
      expect(embed.description).toContain('555666777888999000');
      expect(embed.description).not.toContain('999888777666555444');
      expect(embed.description).toContain('**This removes 2 denylist entries immediately.**');
      expect(parseBatchFooterIds(embed.footer?.text)).toEqual(pickedIds);

      const rows = lastComponentRows(interaction);
      expect(rows).toHaveLength(1);
      const [cancelBtn, removeBtn] = rows[0] as {
        custom_id?: string;
        label?: string;
        style?: number;
      }[];
      expect(cancelBtn.custom_id).toBe('deny::batch-cancel::0::all::date');
      expect(cancelBtn.label).toBe('Cancel');
      expect(cancelBtn.style).toBe(ButtonStyle.Secondary);
      expect(removeBtn.custom_id).toBe('deny::batch-confirm::0::all::date');
      expect(removeBtn.label).toBe('Remove (2)');
      expect(removeBtn.style).toBe(ButtonStyle.Danger);
    });

    it('sends an ephemeral validation followUp when no option values are selected', async () => {
      const interaction = createSelectInteraction({
        customId: 'deny::batch-select::0::all::date',
        values: [],
      });

      await handleDenyBatchPick(interaction);

      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('No entries were selected'),
          flags: MessageFlags.Ephemeral,
        })
      );
    });
  });

  describe('C1 — handleDenyBatchConfirm (5 entries: 1, 3, 5 ok; #2 404; #4 500)', () => {
    it('reaches all 5 entries when #2 returns 404 and #4 returns 500, naming #2 already gone, #4 failed, and 1, 3, 5 succeeded (C1)', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: FIVE_DENY_ENTRIES }));
      stub.removeDenylistEntry.mockImplementation((_type: string, discordId: string) => {
        if (discordId === FIVE_DENY_ENTRIES[1].discordId) {
          return Promise.resolve(makeErr(404, 'Denylist entry not found'));
        }
        if (discordId === FIVE_DENY_ENTRIES[3].discordId) {
          return Promise.resolve(makeErr(500, 'Database failure'));
        }
        return Promise.resolve(makeOk({ success: true }));
      });

      const batchView = buildBrowseResponse(FIVE_DENY_ENTRIES, 0, 'all', 'date', {
        mode: 'batch',
      });
      const pickedIds = FIVE_DENY_ENTRIES.map(e => e.id);
      const pickInteraction = createSelectInteraction({
        customId: 'deny::batch-select::0::all::date',
        values: pickedIds,
        messageComponents: batchView.components,
      });
      await handleDenyBatchPick(pickInteraction);
      const [confirmEmbed] = lastEmbedsJson(pickInteraction);

      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: confirmEmbed.footer?.text,
        description: confirmEmbed.description,
      });

      await handleDenyBatchConfirm(confirmInteraction);

      expect(stub.removeDenylistEntry).toHaveBeenCalledTimes(5);
      for (const [idx, entry] of FIVE_DENY_ENTRIES.entries()) {
        expect(stub.removeDenylistEntry).toHaveBeenNthCalledWith(
          idx + 1,
          entry.type,
          entry.discordId,
          entry.scope,
          entry.scopeId
        );
      }

      const [resultEmbed, refreshedEmbed] = lastEmbedsJson(confirmInteraction);
      const lines = (resultEmbed.description ?? '').split('\n');
      expect(lines).toHaveLength(5);
      expect(lines[0]).toContain('✅');
      expect(lines[0]).toContain(FIVE_DENY_ENTRIES[0].discordId);
      expect(lines[1]).toContain('◻️');
      expect(lines[1]).toContain(FIVE_DENY_ENTRIES[1].discordId);
      expect(lines[1]).toContain('already gone');
      expect(lines[2]).toContain('✅');
      expect(lines[2]).toContain(FIVE_DENY_ENTRIES[2].discordId);
      expect(lines[3]).toContain('❌');
      expect(lines[3]).toContain(FIVE_DENY_ENTRIES[3].discordId);
      expect(lines[3]).toContain(FAILED_TO_REMOVE_NOTE);
      expect(lines[4]).toContain('✅');
      expect(lines[4]).toContain(FIVE_DENY_ENTRIES[4].discordId);
      expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
      expect(refreshedEmbed.title).toContain('Denylist');
    });
  });

  describe('C4 — resolution by the 4-tuple & absent-id handling', () => {
    it('resolves each picked id to its entry (type, discordId, scope, scopeId) and reports an absent id as already gone with NO delete call (C4)', async () => {
      const presentEntry = FIVE_DENY_ENTRIES[2];
      const absentId = '99999999-9999-4999-8999-999999999999';
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: [presentEntry] }));
      stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));

      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([absentId, presentEntry.id]),
      });

      await handleDenyBatchConfirm(confirmInteraction);

      // Only the present entry reaches removeDenylistEntry; the absent id makes no delete call.
      expect(stub.removeDenylistEntry).toHaveBeenCalledTimes(1);
      expect(stub.removeDenylistEntry).toHaveBeenCalledWith(
        presentEntry.type,
        presentEntry.discordId,
        presentEntry.scope,
        presentEntry.scopeId
      );

      const [resultEmbed] = lastEmbedsJson(confirmInteraction);
      const lines = (resultEmbed.description ?? '').split('\n');
      expect(lines[0]).toBe(`◻️ ${fallbackDenyLabel(absentId)} — already gone`);
      expect(lines[1]).toBe(`✅ ${formatDenySelectOption(presentEntry).label}`);
      expect(resultEmbed.color).toBe(DISCORD_COLORS.SUCCESS);
    });

    it('reports an absent picked id as failed (not already gone) with no delete call and logs warn when the re-fetch hits DENYLIST_LIST_MAX_ENTRIES', async () => {
      const cappedEntries = buildDenyEntries(DENYLIST_LIST_MAX_ENTRIES);
      const absentId = '99999999-9999-4999-8999-999999999999';
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: cappedEntries }));

      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([absentId]),
      });

      await handleDenyBatchConfirm(confirmInteraction);

      expect(stub.removeDenylistEntry).not.toHaveBeenCalled();
      const [resultEmbed] = lastEmbedsJson(confirmInteraction);
      const lines = (resultEmbed.description ?? '').split('\n');
      expect(lines).toEqual([`❌ ${fallbackDenyLabel(absentId)} — ${FAILED_TO_REMOVE_NOTE}`]);
      expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
      expect(loggerMock.warn).toHaveBeenCalledWith(
        { userId: 'owner-1', entryId: absentId },
        'Batch denylist pick absent from a capped re-fetch'
      );
    });

    it('still reports the same absent picked id as already gone when the re-fetch is below DENYLIST_LIST_MAX_ENTRIES', async () => {
      const uncappedEntries = buildDenyEntries(DENYLIST_LIST_MAX_ENTRIES - 1);
      const absentId = '99999999-9999-4999-8999-999999999999';
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: uncappedEntries }));

      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([absentId]),
      });

      await handleDenyBatchConfirm(confirmInteraction);

      expect(stub.removeDenylistEntry).not.toHaveBeenCalled();
      const [resultEmbed] = lastEmbedsJson(confirmInteraction);
      const lines = (resultEmbed.description ?? '').split('\n');
      expect(lines).toEqual([`◻️ ${fallbackDenyLabel(absentId)} — already gone`]);
      expect(loggerMock.warn).not.toHaveBeenCalledWith(
        expect.anything(),
        'Batch denylist pick absent from a capped re-fetch'
      );
    });
  });

  describe('C5 — refuse before mutation when pre-loop fetchEntries returns null', () => {
    it('answers with PAGE_FETCH_FAILED_COPY and makes zero delete calls when fetchEntries returns null (C5)', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeErr(503, 'Gateway unavailable'));
      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([FIVE_DENY_ENTRIES[0].id, FIVE_DENY_ENTRIES[1].id]),
      });

      await handleDenyBatchConfirm(confirmInteraction);

      expect(stub.removeDenylistEntry).not.toHaveBeenCalled();
      expect(confirmInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(PAGE_FETCH_FAILED_COPY),
          flags: MessageFlags.Ephemeral,
        })
      );
      // Only the pre-loop component strip ran on editReply.
      expect(confirmInteraction.editReply).toHaveBeenCalledTimes(1);
      expect(vi.mocked(confirmInteraction.editReply).mock.calls[0]?.[0]).toEqual({
        components: [],
      });
    });
  });

  describe('C6 — owner gate on every new handler', () => {
    it('silently denies non-owners on SelectEntry, Pick, Cancel, Confirm, and Button router before any ack, reply, or client call (C6)', async () => {
      vi.mocked(isBotOwner).mockReturnValue(false);

      const selectEntryBtn = createButtonInteraction({
        customId: 'deny::batch-select::0::all::date',
        userId: 'non-owner',
      });
      await handleDenyBatchSelectEntry(selectEntryBtn);
      expect(selectEntryBtn.deferUpdate).not.toHaveBeenCalled();
      expect(selectEntryBtn.editReply).not.toHaveBeenCalled();
      expect(selectEntryBtn.followUp).not.toHaveBeenCalled();

      const pickSelect = createSelectInteraction({
        customId: 'deny::batch-select::0::all::date',
        values: [FIVE_DENY_ENTRIES[0].id],
        userId: 'non-owner',
      });
      await handleDenyBatchPick(pickSelect);
      expect(pickSelect.deferUpdate).not.toHaveBeenCalled();
      expect(pickSelect.editReply).not.toHaveBeenCalled();
      expect(pickSelect.followUp).not.toHaveBeenCalled();

      const cancelBtn = createButtonInteraction({
        customId: 'deny::batch-cancel::0::all::date',
        userId: 'non-owner',
      });
      await handleDenyBatchCancel(cancelBtn);
      expect(cancelBtn.deferUpdate).not.toHaveBeenCalled();
      expect(cancelBtn.editReply).not.toHaveBeenCalled();
      expect(cancelBtn.followUp).not.toHaveBeenCalled();

      const confirmBtn = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([FIVE_DENY_ENTRIES[0].id]),
        userId: 'non-owner',
      });
      await handleDenyBatchConfirm(confirmBtn);
      expect(confirmBtn.deferUpdate).not.toHaveBeenCalled();
      expect(confirmBtn.editReply).not.toHaveBeenCalled();
      expect(confirmBtn.followUp).not.toHaveBeenCalled();

      const routedBtn = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([FIVE_DENY_ENTRIES[0].id]),
        userId: 'non-owner',
      });
      await handleDenyBatchButton(routedBtn);
      expect(routedBtn.deferUpdate).not.toHaveBeenCalled();
      expect(routedBtn.editReply).not.toHaveBeenCalled();
      expect(routedBtn.followUp).not.toHaveBeenCalled();

      expect(stub.listDenylistEntries).not.toHaveBeenCalled();
      expect(stub.removeDenylistEntry).not.toHaveBeenCalled();
    });
  });

  describe('C7 — throwing delete normalized to FAILED_TO_REMOVE_NOTE and logged with ids only', () => {
    it('normalizes a thrown removeDenylistEntry error to FAILED_TO_REMOVE_NOTE (never the raw message) and logs warn with { err, userId, entryId } (C7)', async () => {
      const targetEntry = FIVE_DENY_ENTRIES[3];
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: [targetEntry] }));
      const rawError = new Error('raw transport socket hang up');
      stub.removeDenylistEntry.mockRejectedValue(rawError);

      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([targetEntry.id]),
      });

      await handleDenyBatchConfirm(confirmInteraction);

      const [resultEmbed] = lastEmbedsJson(confirmInteraction);
      expect(resultEmbed.description).toContain(
        `❌ ${formatDenySelectOption(targetEntry).label} — ${FAILED_TO_REMOVE_NOTE}`
      );
      expect(resultEmbed.description).not.toContain('raw transport socket hang up');
      expect(loggerMock.warn).toHaveBeenCalledWith(
        { err: rawError, userId: 'owner-1', entryId: targetEntry.id },
        'Batch denylist removal item threw'
      );
      // Never logs the entry's reason text.
      expect(JSON.stringify(loggerMock.warn.mock.calls)).not.toContain('Sensitive reason text');
    });

    it('logs warn with { userId, entryId, status } on a non-ok non-404 delete result without logging reason text', async () => {
      const targetEntry = FIVE_DENY_ENTRIES[3];
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: [targetEntry] }));
      stub.removeDenylistEntry.mockResolvedValue(makeErr(502, 'Bad gateway'));

      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([targetEntry.id]),
      });

      await handleDenyBatchConfirm(confirmInteraction);

      expect(loggerMock.warn).toHaveBeenCalledWith(
        { userId: 'owner-1', entryId: targetEntry.id, status: 502 },
        'Batch denylist removal item failed'
      );
      expect(JSON.stringify(loggerMock.warn.mock.calls)).not.toContain('Sensitive reason text');
    });
  });

  describe('C2 — one-pick path unchanged alongside batch predicates', () => {
    it('keeps handleBrowseSelect routing to showDetailView while batch predicates ignore single-pick and detail customIds (C2)', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: FIVE_DENY_ENTRIES }));

      expect(isDenyBatchButton('deny::browse::0::all::date::')).toBe(false);
      expect(isDenyBatchButton('deny::browse-select::0::all::date::')).toBe(false);
      expect(isDenyBatchButton('deny::del::11111111-1111-4111-8111-000000000001')).toBe(false);
      expect(isDenyBatchSelect('deny::browse-select::0::all::date::')).toBe(false);
      expect(isDenyBatchSelect('deny::batch-confirm::0::all::date')).toBe(false);
      expect(isDenyBatchSelect('deny::batch-select::0::all::date')).toBe(true);

      const singleSelect = createSelectInteraction({
        customId: 'deny::browse-select::0::all::date::',
        values: [FIVE_DENY_ENTRIES[0].id],
      });
      await handleBrowseSelect(singleSelect);

      expect(showDetailViewMock).toHaveBeenCalledWith(singleSelect, FIVE_DENY_ENTRIES[0], {
        source: 'browse',
        page: 0,
        filter: 'all',
        sort: 'date',
      });
    });
  });

  describe('Hardening — pre-loop try/catch, label recovery, cancel, and router debug', () => {
    it('strips confirm components BEFORE pre-loop fetchEntries and removeDenylistEntry, and skips ack when already deferred', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: [FIVE_DENY_ENTRIES[0]] }));
      stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));

      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([FIVE_DENY_ENTRIES[0].id]),
        deferred: true,
      });

      await handleDenyBatchConfirm(confirmInteraction);

      expect(confirmInteraction.deferUpdate).not.toHaveBeenCalled();
      expect(vi.mocked(confirmInteraction.editReply).mock.calls[0]?.[0]).toEqual({
        components: [],
      });
      const stripOrder = vi.mocked(confirmInteraction.editReply).mock.invocationCallOrder[0];
      const fetchOrder = stub.listDenylistEntries.mock.invocationCallOrder[0];
      const deleteOrder = stub.removeDenylistEntry.mock.invocationCallOrder[0];
      expect(stripOrder).toBeLessThan(fetchOrder);
      expect(fetchOrder).toBeLessThan(deleteOrder);
    });

    it('logs error, answers on an ephemeral followUp, and makes no delete call when pre-loop component strip throws', async () => {
      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([FIVE_DENY_ENTRIES[0].id]),
      });
      vi.mocked(confirmInteraction.editReply).mockRejectedValueOnce(new Error('strip failed'));

      await handleDenyBatchConfirm(confirmInteraction);

      expect(stub.removeDenylistEntry).not.toHaveBeenCalled();
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner-1' }),
        'Error preparing deny batch confirm'
      );
      expect(confirmInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to remove denylist entries'),
          flags: MessageFlags.Ephemeral,
        })
      );
    });

    it('swallows and logs warn when both the pre-loop component strip and the error followUp reject', async () => {
      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([FIVE_DENY_ENTRIES[0].id]),
      });
      vi.mocked(confirmInteraction.editReply).mockRejectedValueOnce(new Error('strip failed'));
      vi.mocked(confirmInteraction.followUp).mockRejectedValueOnce(new Error('followUp failed'));

      await expect(handleDenyBatchConfirm(confirmInteraction)).resolves.toBeUndefined();

      expect(stub.removeDenylistEntry).not.toHaveBeenCalled();
      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner-1' }),
        'Deny batch confirm error followUp failed'
      );
    });

    it('sends an ephemeral missing-selection followUp without calling delete when the confirm footer is missing', async () => {
      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
      });

      await handleDenyBatchConfirm(confirmInteraction);

      expect(stub.listDenylistEntries).not.toHaveBeenCalled();
      expect(stub.removeDenylistEntry).not.toHaveBeenCalled();
      expect(confirmInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Could not determine which entries were selected'),
          flags: MessageFlags.Ephemeral,
        })
      );
    });

    it('uses recovered confirm labels as-is without double-escaping markdown', async () => {
      const entryWithMarkdownId = {
        ...FIVE_DENY_ENTRIES[0],
        discordId: '*111222333*',
      } satisfies DenylistEntryResponse;
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: [entryWithMarkdownId] }));
      stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));

      const batchView = buildBrowseResponse([entryWithMarkdownId], 0, 'all', 'date', {
        mode: 'batch',
      });
      const pickInteraction = createSelectInteraction({
        customId: 'deny::batch-select::0::all::date',
        values: [entryWithMarkdownId.id],
        messageComponents: batchView.components,
      });
      await handleDenyBatchPick(pickInteraction);
      const [confirmEmbed] = lastEmbedsJson(pickInteraction);

      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: confirmEmbed.footer?.text,
        description: confirmEmbed.description,
      });
      await handleDenyBatchConfirm(confirmInteraction);

      const [resultEmbed] = lastEmbedsJson(confirmInteraction);
      expect(resultEmbed.description).toContain('\\*111222333\\*');
      expect(resultEmbed.description).not.toContain('\\\\');
    });

    it('shows the entry discordId via formatDenySelectOption for an id present in the re-fetch and fallbackDenyLabel for an absent id when confirm has no description', async () => {
      const presentEntry = FIVE_DENY_ENTRIES[0];
      const absentId = '99999999-9999-4999-8999-999999999999';
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: [presentEntry] }));
      stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));

      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([presentEntry.id, absentId]),
      });

      await handleDenyBatchConfirm(confirmInteraction);

      const [resultEmbed] = lastEmbedsJson(confirmInteraction);
      const lines = (resultEmbed.description ?? '').split('\n');
      expect(lines).toHaveLength(2);
      expect(lines[0]).toBe(`✅ ${formatDenySelectOption(presentEntry).label}`);
      expect(lines[0]).toContain(presentEntry.discordId);
      expect(lines[1]).toBe(`◻️ ${fallbackDenyLabel(absentId)} — already gone`);
    });

    it('falls back to tier (b)/(c) labels for every result line when the confirm listing has fewer bullet lines than the footer has ids', async () => {
      const firstEntry = FIVE_DENY_ENTRIES[0];
      const secondEntry = FIVE_DENY_ENTRIES[1];
      const absentId = '99999999-9999-4999-8999-999999999999';
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: [firstEntry, secondEntry] }));
      stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));

      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([firstEntry.id, secondEntry.id, absentId]),
        description:
          '• 1. Misaligned Recovered Label\n\n**This removes 3 denylist entries immediately.** This action cannot be undone.',
      });

      await handleDenyBatchConfirm(confirmInteraction);

      const [resultEmbed] = lastEmbedsJson(confirmInteraction);
      const lines = (resultEmbed.description ?? '').split('\n');
      expect(lines).toEqual([
        `✅ ${formatDenySelectOption(firstEntry).label}`,
        `✅ ${formatDenySelectOption(secondEntry).label}`,
        `◻️ ${fallbackDenyLabel(absentId)} — already gone`,
      ]);
      expect(resultEmbed.description).not.toContain('Misaligned Recovered Label');
    });

    it('recovers the matched prefix of labels (excluding the last potentially-cut line) when the deny confirm listing is clamped at the real budget (C8)', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: FIVE_DENY_ENTRIES }));
      stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));

      // Clamped to fewer lines than footer ids via clampBatchConfirmDescription at the real budget:
      // lines 1 and 2 survive whole, line 3 is cut mid-label, and line 4 is cut off completely.
      const label1 = `1. First Recovered Label ${'A'.repeat(1400)}`;
      const label2 = `2. Second Recovered Label ${'B'.repeat(1400)}`;
      const label3 = `3. Cut Third Label ${'C'.repeat(1000)}`;
      const label4 = '4. Fourth Label';
      const clampedFewerLines = clampBatchConfirmDescription(
        [label1, label2, label3, label4].map(label => `${LISTING_BULLET}${label}`).join('\n'),
        '**This removes 4 denylist entries immediately.** This action cannot be undone.'
      );
      const confirm1 = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([
          FIVE_DENY_ENTRIES[0].id,
          FIVE_DENY_ENTRIES[1].id,
          FIVE_DENY_ENTRIES[2].id,
          FIVE_DENY_ENTRIES[3].id,
        ]),
        description: clampedFewerLines,
      });
      await handleDenyBatchConfirm(confirm1);
      const [embed1] = lastEmbedsJson(confirm1);
      expect((embed1.description ?? '').split('\n')).toEqual([
        `✅ ${label1}`,
        `✅ ${label2}`,
        `✅ ${formatDenySelectOption(FIVE_DENY_ENTRIES[2]).label}`,
        `✅ ${formatDenySelectOption(FIVE_DENY_ENTRIES[3]).label}`,
      ]);

      // End-to-end handleDenyBatchPick -> handleDenyBatchConfirm with 25 markdown-heavy entries:
      // clamps inside the 25th bullet line (equal line count), so lines 1–24 recover and line 25 falls back.
      const twentyFiveMarkdownEntries: DenylistEntryResponse[] = Array.from(
        { length: 25 },
        (_, idx) => ({
          ...FIVE_DENY_ENTRIES[0],
          id: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, '0')}`,
          discordId: `${'*_~'.repeat(28)}${idx + 1}`,
        })
      );
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: twentyFiveMarkdownEntries }));
      const pickInteraction = createSelectInteraction({
        customId: 'deny::batch-select::0::all::date',
        values: twentyFiveMarkdownEntries.map(entry => entry.id),
        messageComponents: [
          {
            toJSON: () => ({
              components: [
                {
                  options: twentyFiveMarkdownEntries.map((entry, idx) => ({
                    value: entry.id,
                    label: `${idx + 1}. ${formatDenySelectOption(entry).label}`,
                  })),
                },
              ],
            }),
          },
        ],
      });
      await handleDenyBatchPick(pickInteraction);
      const [confirmEmbed] = lastEmbedsJson(pickInteraction);

      const confirm2 = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: confirmEmbed.footer?.text,
        description: confirmEmbed.description,
      });
      await handleDenyBatchConfirm(confirm2);
      const [embed2] = lastEmbedsJson(confirm2);
      const resultLines = (embed2.description ?? '').split('\n');
      expect(resultLines).toHaveLength(25);
      expect(resultLines[0]).toContain('✅ 1. 🧍 ');
      // Line 25 falls back to the unnumbered formatDenySelectOption label (not the cut `25. …` confirm line).
      expect(resultLines[24]).toMatch(/^✅ 🧍 /);
      expect(resultLines[24]).not.toContain('…');
    });

    it('recovers the bulleted confirm listing labels built by handleDenyBatchPick for two picks on confirm', async () => {
      const pickedEntries = [FIVE_DENY_ENTRIES[0], FIVE_DENY_ENTRIES[2]];
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: FIVE_DENY_ENTRIES }));
      stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));

      const batchView = buildBrowseResponse(FIVE_DENY_ENTRIES, 0, 'all', 'date', {
        mode: 'batch',
      });
      const pickInteraction = createSelectInteraction({
        customId: 'deny::batch-select::0::all::date',
        values: pickedEntries.map(entry => entry.id),
        messageComponents: batchView.components,
      });
      await handleDenyBatchPick(pickInteraction);
      const [confirmEmbed] = lastEmbedsJson(pickInteraction);

      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: confirmEmbed.footer?.text,
        description: confirmEmbed.description,
      });
      await handleDenyBatchConfirm(confirmInteraction);

      const [resultEmbed] = lastEmbedsJson(confirmInteraction);
      const lines = (resultEmbed.description ?? '').split('\n');
      expect(lines).toEqual([
        `✅ 1. ${formatDenySelectOption(FIVE_DENY_ENTRIES[0]).label}`,
        `✅ 3. ${formatDenySelectOption(FIVE_DENY_ENTRIES[2]).label}`,
      ]);
    });

    it('strips embedded newlines from a picked option label so it renders as one bullet line and every later label recovers onto its own id', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: FIVE_DENY_ENTRIES }));
      stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));

      const pickedIds = [FIVE_DENY_ENTRIES[0].id, FIVE_DENY_ENTRIES[1].id];
      const pickInteraction = createSelectInteraction({
        customId: 'deny::batch-select::0::all::date',
        values: pickedIds,
        messageComponents: [
          {
            toJSON: () => ({
              components: [
                {
                  options: [
                    {
                      value: FIVE_DENY_ENTRIES[0].id,
                      label: '1. 🧍 111222333444555666\n• Injected',
                    },
                    {
                      value: FIVE_DENY_ENTRIES[1].id,
                      label: '2. 🏛️ 999888777666555444',
                    },
                  ],
                },
              ],
            }),
          },
        ],
      });
      await handleDenyBatchPick(pickInteraction);
      const [confirmEmbed] = lastEmbedsJson(pickInteraction);
      const listingLines = (confirmEmbed.description ?? '').split('\n\n')[0]?.split('\n');
      expect(listingLines).toEqual([
        '• 1. 🧍 111222333444555666 • Injected',
        '• 2. 🏛️ 999888777666555444',
      ]);

      const confirmInteraction = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: confirmEmbed.footer?.text,
        description: confirmEmbed.description,
      });
      await handleDenyBatchConfirm(confirmInteraction);
      const [resultEmbed] = lastEmbedsJson(confirmInteraction);
      expect((resultEmbed.description ?? '').split('\n')).toEqual([
        '✅ 1. 🧍 111222333444555666 • Injected',
        '✅ 2. 🏛️ 999888777666555444',
      ]);

      // Under clamped recovery (25 items), an embedded `\n• ` on item 1 must not shift item 2's label onto id 3.
      const twentyFiveEntries = buildDenyEntries(25);
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: twentyFiveEntries }));
      const clampedPick = createSelectInteraction({
        customId: 'deny::batch-select::0::all::date',
        values: twentyFiveEntries.map(entry => entry.id),
        messageComponents: [
          {
            toJSON: () => ({
              components: [
                {
                  options: twentyFiveEntries.map((entry, idx) => ({
                    value: entry.id,
                    label:
                      idx === 0
                        ? `1. 🧍 ${entry.discordId}\n• Injected`
                        : idx === 1
                          ? `2. 🧍 ${entry.discordId}`
                          : `${idx + 1}. 🧍 ${'*_~'.repeat(28)}${idx + 1}`,
                  })),
                },
              ],
            }),
          },
        ],
      });
      await handleDenyBatchPick(clampedPick);
      const [clampedConfirmEmbed] = lastEmbedsJson(clampedPick);
      const clampedConfirm = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: clampedConfirmEmbed.footer?.text,
        description: clampedConfirmEmbed.description,
      });
      await handleDenyBatchConfirm(clampedConfirm);
      const [clampedResultEmbed] = lastEmbedsJson(clampedConfirm);
      const clampedResultLines = (clampedResultEmbed.description ?? '').split('\n');
      expect(clampedResultLines[0]).toBe(`✅ 1. 🧍 ${twentyFiveEntries[0].discordId} • Injected`);
      expect(clampedResultLines[1]).toBe(`✅ 2. 🧍 ${twentyFiveEntries[1].discordId}`);
    });

    it('skips deferUpdate and still renders when handleDenyBatchSelectEntry, handleDenyBatchPick, or handleDenyBatchCancel is called with deferred: true', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: FIVE_DENY_ENTRIES }));

      const selectInteraction = createButtonInteraction({
        customId: 'deny::batch-select::0::all::date',
        deferred: true,
      });
      await handleDenyBatchSelectEntry(selectInteraction);

      expect(selectInteraction.deferUpdate).not.toHaveBeenCalled();
      expect(selectInteraction.editReply).toHaveBeenCalledTimes(1);
      expect(lastComponentRows(selectInteraction)).toHaveLength(2);

      const pickInteraction = createSelectInteraction({
        customId: 'deny::batch-select::0::all::date',
        values: [FIVE_DENY_ENTRIES[0].id],
        deferred: true,
      });
      await handleDenyBatchPick(pickInteraction);

      expect(pickInteraction.deferUpdate).not.toHaveBeenCalled();
      expect(pickInteraction.editReply).toHaveBeenCalledTimes(1);
      expect(lastEmbedsJson(pickInteraction)[0]?.title).toContain('Remove Denylist Entries?');
      expect(lastComponentRows(pickInteraction)).toHaveLength(1);

      const cancelInteraction = createButtonInteraction({
        customId: 'deny::batch-cancel::0::all::date',
        deferred: true,
      });
      await handleDenyBatchCancel(cancelInteraction);

      expect(cancelInteraction.deferUpdate).not.toHaveBeenCalled();
      expect(cancelInteraction.editReply).toHaveBeenCalledTimes(1);
      expect(lastComponentRows(cancelInteraction)).toHaveLength(3);
    });

    it('returns to the single-select browse view for the carried page/filter/sort on batch-cancel without deleting', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: FIVE_DENY_ENTRIES }));
      const cancelInteraction = createButtonInteraction({
        customId: 'deny::batch-cancel::0::user::name',
      });

      await handleDenyBatchButton(cancelInteraction);

      expect(cancelInteraction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(stub.removeDenylistEntry).not.toHaveBeenCalled();
      const rows = lastComponentRows(cancelInteraction);
      // Single-mode rows: single-select + Select several toggle + pagination/sort/filter row = 3 rows
      expect(rows).toHaveLength(3);
      expect(rows[0][0]).toMatchObject({
        custom_id: 'deny::browse-select::0::user::name::',
      });
      expect(rows[1][0]).toMatchObject({
        custom_id: 'deny::batch-select::0::user::name',
        label: 'Select several',
      });
    });

    it('logs debug and returns without acking when handleDenyBatchButton receives an unmatched customId', async () => {
      const interaction = createButtonInteraction({
        customId: 'deny::del::entry-1',
      });

      await handleDenyBatchButton(interaction);

      expect(loggerMock.debug).toHaveBeenCalledWith(
        { customId: 'deny::del::entry-1' },
        'Ignoring non-batch customId'
      );
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
      expect(stub.removeDenylistEntry).not.toHaveBeenCalled();
    });

    it('logs error and sends followUp when clientsFor throws on batch-select', async () => {
      clientsForMock.mockImplementationOnce(() => {
        throw new Error('clientsFor failed');
      });
      const interaction = createButtonInteraction({
        customId: 'deny::batch-select::0::all::date',
      });

      await handleDenyBatchSelectEntry(interaction);

      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner-1', mode: 'batch' }),
        'Error refreshing deny browse view'
      );
      expect(interaction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to remove denylist entries'),
          flags: MessageFlags.Ephemeral,
        })
      );
    });

    it('logs error and sends followUp when editReply rejects on batch-cancel', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: FIVE_DENY_ENTRIES }));
      const cancelInteraction = createButtonInteraction({
        customId: 'deny::batch-cancel::0::all::date',
      });
      vi.mocked(cancelInteraction.editReply).mockRejectedValueOnce(new Error('editReply failed'));

      await handleDenyBatchCancel(cancelInteraction);

      expect(loggerMock.error).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner-1', mode: 'single' }),
        'Error refreshing deny browse view'
      );
      expect(cancelInteraction.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('Failed to remove denylist entries'),
          flags: MessageFlags.Ephemeral,
        })
      );
    });

    it('swallows and logs warn when editReply and refresh followUp both reject', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: FIVE_DENY_ENTRIES }));
      const cancelInteraction = createButtonInteraction({
        customId: 'deny::batch-cancel::0::all::date',
      });
      vi.mocked(cancelInteraction.editReply).mockRejectedValueOnce(new Error('editReply failed'));
      vi.mocked(cancelInteraction.followUp).mockRejectedValueOnce(new Error('followUp failed'));

      await expect(handleDenyBatchCancel(cancelInteraction)).resolves.toBeUndefined();

      expect(loggerMock.warn).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'owner-1' }),
        'Deny batch refresh error followUp failed'
      );
    });

    it('pins FAILED_TO_REMOVE_NOTE to the one-pick delete entry failure copy', () => {
      const onePickCopy = DASHBOARD_MESSAGES.OPERATION_FAILED('delete entry');
      expect(onePickCopy.endsWith(FAILED_TO_REMOVE_NOTE)).toBe(true);
    });
  });

  describe('survival ladder & customId length budget', () => {
    it('delivers result-only embed when post-loop refresh fails, and falls back to counts followUp when editReply rejects', async () => {
      let listCallCount = 0;
      stub.listDenylistEntries.mockImplementation(() => {
        listCallCount += 1;
        return listCallCount === 1
          ? Promise.resolve(makeOk({ entries: [FIVE_DENY_ENTRIES[0]] }))
          : Promise.resolve(makeErr(500, 'refresh failed'));
      });
      stub.removeDenylistEntry.mockResolvedValue(makeOk({ success: true }));

      const interaction1 = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([FIVE_DENY_ENTRIES[0].id]),
      });
      await handleDenyBatchConfirm(interaction1);
      expect(lastEmbedsJson(interaction1)).toHaveLength(1);

      // When both post-mutation editReply attempts reject, followUp carries the counts line.
      stub.listDenylistEntries.mockResolvedValue(makeOk({ entries: FIVE_DENY_ENTRIES }));
      const interaction2 = createButtonInteraction({
        customId: 'deny::batch-confirm::0::all::date',
        footerText: encodeBatchFooterIds([FIVE_DENY_ENTRIES[0].id]),
      });
      vi.mocked(interaction2.editReply)
        .mockResolvedValueOnce(undefined as never)
        .mockRejectedValueOnce(new Error('Invalid Form Body'))
        .mockRejectedValueOnce(new Error('Unknown Message'));

      await handleDenyBatchConfirm(interaction2);

      expect(interaction2.followUp).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('1 succeeded, 0 already gone, 0 failed'),
          flags: MessageFlags.Ephemeral,
        })
      );
    });

    it('buildRefreshedDenyBrowseView returns null when fetchEntries returns null', async () => {
      stub.listDenylistEntries.mockResolvedValue(makeErr(500, 'boom'));
      const view = await buildRefreshedDenyBrowseView(asOwnerClient(stub), {
        page: 0,
        filter: 'all',
        sort: 'date',
      });
      expect(view).toBeNull();
    });

    it('keeps all deny batch customIds well under the 100-char Discord limit', () => {
      const actions = ['batch-select', 'batch-confirm', 'batch-cancel'] as const;
      const filters: DenyBrowseFilter[] = ['all', 'user', 'guild'];
      const sorts = ['name', 'date'] as const;
      const pages = [0, 999, Number.MAX_SAFE_INTEGER];

      for (const action of actions) {
        for (const filter of filters) {
          for (const sort of sorts) {
            for (const page of pages) {
              const id = buildDenyBatchCustomId(action, page, filter, sort);
              expect(id.length).toBeLessThanOrEqual(DISCORD_LIMITS.CUSTOM_ID_MAX_LENGTH);
            }
          }
        }
      }
    });
  });
});
