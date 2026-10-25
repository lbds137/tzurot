/**
 * Tests for the character alias batch remove flow ("Select several") —
 * entry swap, confirm view (pick), cancel, footer codec, and budget guard.
 * Confirm execution tests live in aliasBatchConfirm.test.ts.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ButtonStyle, MessageFlags, type StringSelectMenuInteraction } from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import {
  DEFAULT_COORDS,
  FIVE_ROWS,
  createButtonInteraction,
  editReplyEmbeds,
  editReplyPayload,
  makeAliasRow,
  mockUserClient,
  myAliasesPayload,
} from '../../test/mocks/aliasBatch.mock.js';
import {
  BATCH_CANCEL_PREFIX,
  BATCH_CONFIRM_PREFIX,
  MAX_BATCH_FOOTER_LENGTH,
  buildAliasBatchSelectComponents,
  encodeAliasBatchFooterIds,
  exceedsBatchFooterBudget,
  handleAliasBatchCancel,
  handleAliasBatchPick,
  handleAliasBatchSelectEntry,
  parseAliasBatchFooterIds,
} from './aliasBatch.js';
import { handleAliasBatchConfirm } from './aliasBatchConfirm.js';
import {
  BATCH_SELECT_PREFIX,
  buildRemoveCustomId,
  formatAliasSelectValue,
} from './aliasBrowseView.js';
import { handleButton, handleSelectMenu } from './interactionRouting.js';

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

vi.mock('../../utils/gatewayClients.js', async () => {
  const { mockUserClient } = await import('../../test/mocks/aliasBatch.mock.js');
  return { clientsFor: () => ({ userClient: mockUserClient }) };
});

function editReplyComponentRows(interaction: unknown): Record<string, unknown>[][] {
  return (editReplyPayload(interaction).components ?? []).map(
    row => (row as { toJSON(): { components: Record<string, unknown>[] } }).toJSON().components
  );
}

function createSelectInteraction(options: {
  values: string[];
  customId?: string;
  messageComponents?: unknown[];
}): StringSelectMenuInteraction {
  return {
    user: { id: 'user-1' },
    customId:
      options.customId ??
      buildRemoveCustomId(
        BATCH_SELECT_PREFIX,
        DEFAULT_COORDS.page,
        DEFAULT_COORDS.filter,
        DEFAULT_COORDS.query
      ),
    values: options.values,
    message: {
      id: 'message-1',
      components: options.messageComponents ?? [],
    },
    deferred: false,
    replied: false,
    deferUpdate: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  } as unknown as StringSelectMenuInteraction;
}

describe('C3 — buildAliasBatchSelectComponents & handleAliasBatchSelectEntry (real multi-select)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload(FIVE_ROWS));
  });

  it('renders a multi-select with min 1, max capped at min(15, item count), customId batch-select, and NO pagination row (C3)', () => {
    const rows = buildAliasBatchSelectComponents(FIVE_ROWS, DEFAULT_COORDS);
    expect(rows).toHaveLength(2);

    const [selectRow, cancelRow] = rows.map(row => row.toJSON().components);
    expect(selectRow).toHaveLength(1);
    const selectData = selectRow[0] as unknown as {
      custom_id: string;
      min_values: number;
      max_values: number;
      options: { value: string; label: string }[];
    };
    expect(selectData.custom_id).toBe('character-alias::batch-select::0::all::');
    expect(selectData.min_values).toBe(1);
    expect(selectData.max_values).toBe(5);
    expect(selectData.options.map(o => o.value)).toEqual(FIVE_ROWS.map(formatAliasSelectValue));

    expect(cancelRow).toHaveLength(1);
    expect(cancelRow[0]).toMatchObject({
      custom_id: 'character-alias::batch-cancel::0::all::',
      label: 'Cancel',
    });

    // Also verify page ceiling clamp at 15 when 15 items are on the page.
    const fifteenRows = Array.from({ length: 15 }, (_, idx) =>
      makeAliasRow({ alias: `alias-${idx}` })
    );
    const fullPageRows = buildAliasBatchSelectComponents(fifteenRows, DEFAULT_COORDS);
    const fullSelect = fullPageRows[0].toJSON().components[0] as unknown as {
      min_values: number;
      max_values: number;
    };
    expect(fullSelect.min_values).toBe(1);
    expect(fullSelect.max_values).toBe(15);
  });

  it('acks first, fetches rows for the carried coords, and swaps the view into multi-select mode', async () => {
    const interaction = createButtonInteraction({
      customId: 'character-alias::batch-select::0::all::',
    });

    await handleAliasBatchSelectEntry(interaction);

    const deferOrder = vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0];
    const fetchOrder = mockUserClient.listMyAliases.mock.invocationCallOrder[0];
    expect(deferOrder).toBeLessThan(fetchOrder);

    const componentRows = editReplyComponentRows(interaction);
    expect(componentRows).toHaveLength(2);
    const selectMenu = componentRows[0][0] as { custom_id?: string; max_values?: number };
    expect(selectMenu.custom_id).toBe('character-alias::batch-select::0::all::');
    expect(selectMenu.max_values).toBe(5);
  });

  it('refuses with transient copy when the entry page fetch fails', async () => {
    mockUserClient.listMyAliases.mockResolvedValue({
      ok: false,
      status: 500,
      error: 'gateway down',
    });
    const interaction = createButtonInteraction({
      customId: 'character-alias::batch-select::0::all::',
    });

    await handleAliasBatchSelectEntry(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Couldn't load that page"),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it('refuses with expiry copy when the entry customId coordinates are malformed', async () => {
    const interaction = createButtonInteraction({
      customId: 'character-alias::batch-select::bad::filter::',
    });

    await handleAliasBatchSelectEntry(interaction);

    expect(interaction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('/character alias browse'),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(mockUserClient.listMyAliases).not.toHaveBeenCalled();
  });
});

describe('batch customId length guard', () => {
  it('keeps every batch customId within the Discord cap with a max-length slug coordinate', () => {
    const maxSlug = 's'.repeat(DISCORD_LIMITS.SLUG_MAX_LENGTH);
    const ids = [
      buildRemoveCustomId(BATCH_SELECT_PREFIX, 0, 'all', maxSlug),
      buildRemoveCustomId(BATCH_CONFIRM_PREFIX, 0, 'all', maxSlug),
      buildRemoveCustomId(BATCH_CANCEL_PREFIX, 0, 'all', maxSlug),
    ];
    // Positive control: the max-length slug actually rides each id, so the
    // length assertions below are not passing vacuously.
    expect(ids[0]).toBe(`character-alias::batch-select::0::all::${maxSlug}`);
    for (const id of ids) {
      expect(id.length).toBeLessThanOrEqual(DISCORD_LIMITS.CUSTOM_ID_MAX_LENGTH);
    }
  });
});

describe('handleAliasBatchPick (confirm view)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acks first, lists every picked alias from option labels, and renders single-verb Remove (N) + Cancel', async () => {
    const swapped = buildAliasBatchSelectComponents(FIVE_ROWS, DEFAULT_COORDS);
    const pickedValues = ['user:mommy', 'global:lila'];
    const interaction = createSelectInteraction({
      values: pickedValues,
      messageComponents: swapped,
    });

    await handleAliasBatchPick(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    const [embed] = editReplyEmbeds(interaction);
    expect(embed.title).toContain('Remove Several Aliases');
    expect(embed.description).toContain('@mommy');
    expect(embed.description).toContain('@lila');
    expect(embed.description).not.toContain('@queen');
    expect(parseAliasBatchFooterIds(embed.footer?.text)).toEqual(pickedValues);

    const rows = editReplyComponentRows(interaction);
    expect(rows).toHaveLength(1);
    const [cancelBtn, removeBtn] = rows[0] as {
      custom_id?: string;
      label?: string;
      style?: number;
    }[];
    expect(cancelBtn.custom_id).toBe('character-alias::batch-cancel::0::all::');
    expect(cancelBtn.label).toBe('Cancel');
    expect(removeBtn.custom_id).toBe('character-alias::batch-confirm::0::all::');
    expect(removeBtn.label).toBe('Remove (2)');
    expect(removeBtn.style).toBe(ButtonStyle.Danger);
  });

  it('refuses with validation copy when no values are selected', async () => {
    const interaction = createSelectInteraction({ values: [] });

    await handleAliasBatchPick(interaction);

    expect(interaction.followUp).toHaveBeenCalledTimes(1);
    expect(interaction.editReply).not.toHaveBeenCalled();
  });
});

describe('C2 — one-pick path unchanged alongside batch routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload(FIVE_ROWS));
  });

  it('routes browse-select to the single-alias confirm and batch-select to the batch confirm (C2)', async () => {
    const singleSelect = createSelectInteraction({
      customId: 'character-alias::browse-select::0::all::',
      values: ['user:mommy'],
    });
    await handleSelectMenu(singleSelect);

    const [singleEmbed] = editReplyEmbeds(singleSelect);
    expect(singleEmbed.title).toBe('🏷️ Remove Alias?');
    expect(singleEmbed.footer?.text).toBe('user\nlilith\nmommy');

    const batchSelect = createSelectInteraction({
      customId: 'character-alias::batch-select::0::all::',
      values: ['user:mommy', 'global:lila'],
      messageComponents: buildAliasBatchSelectComponents(FIVE_ROWS, DEFAULT_COORDS),
    });
    await handleSelectMenu(batchSelect);

    const [batchEmbed] = editReplyEmbeds(batchSelect);
    expect(batchEmbed.title).toContain('Remove Several Aliases');
    expect(parseAliasBatchFooterIds(batchEmbed.footer?.text)).toEqual([
      'user:mommy',
      'global:lila',
    ]);
  });
});

describe('C4 — newline-containing alias round-trip through batch footer codec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('encodes, parses, decodes, resolves, and calls removePersonalityAlias with the full newline alias verbatim (C4)', async () => {
    const newlineRow = makeAliasRow({
      alias: 'odd\nalias',
      scope: 'user',
      character: { name: 'Lilith', slug: 'lilith' },
    });
    const rows = [newlineRow, FIVE_ROWS[1]];
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload(rows));
    mockUserClient.removePersonalityAlias.mockResolvedValue({
      ok: true,
      status: 200,
      data: { removedAlias: 'odd\nalias', removedScope: 'user' },
    });

    const swapped = buildAliasBatchSelectComponents(rows, DEFAULT_COORDS);
    const pickInteraction = createSelectInteraction({
      values: [formatAliasSelectValue(newlineRow), formatAliasSelectValue(FIVE_ROWS[1])],
      messageComponents: swapped,
    });

    await handleAliasBatchPick(pickInteraction);

    const [confirmEmbed] = editReplyEmbeds(pickInteraction);
    const footerText = confirmEmbed.footer?.text;
    expect(footerText).toBeDefined();
    expect(parseAliasBatchFooterIds(footerText)).toEqual(['user:odd\nalias', 'global:lila']);

    const confirmInteraction = createButtonInteraction({
      footerText,
    });
    await handleAliasBatchConfirm(confirmInteraction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(2);
    expect(mockUserClient.removePersonalityAlias).toHaveBeenNthCalledWith(
      1,
      'lilith',
      'odd\nalias',
      { scope: 'user' }
    );
    expect(mockUserClient.removePersonalityAlias).toHaveBeenNthCalledWith(
      2,
      'lila-elyona',
      'lila',
      { scope: 'global' }
    );
  });

  it('round-trips an alias containing a literal % (and literal %0A) alongside a newline alias in the same selection', async () => {
    const percentRow = makeAliasRow({
      alias: '100%',
      scope: 'user',
      character: { name: 'Lilith', slug: 'lilith' },
    });
    const literalEscapeRow = makeAliasRow({
      alias: 'literal%0Atext',
      scope: 'global',
      character: { name: 'Nyx', slug: 'nyx' },
    });
    const newlineRow = makeAliasRow({
      alias: 'odd\r\nalias',
      scope: 'user',
      character: { name: 'Lila Elyona', slug: 'lila-elyona' },
    });
    const rows = [percentRow, literalEscapeRow, newlineRow];
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload(rows));
    mockUserClient.removePersonalityAlias.mockImplementation(
      (slug: string, alias: string, opts: { scope?: string }) =>
        Promise.resolve({
          ok: true,
          status: 200,
          data: { removedAlias: alias, removedScope: opts.scope ?? 'user', slug },
        })
    );

    const swapped = buildAliasBatchSelectComponents(rows, DEFAULT_COORDS);
    const pickInteraction = createSelectInteraction({
      values: rows.map(formatAliasSelectValue),
      messageComponents: swapped,
    });

    await handleAliasBatchPick(pickInteraction);

    const [confirmEmbed] = editReplyEmbeds(pickInteraction);
    const footerText = confirmEmbed.footer?.text;
    expect(footerText).toBe('user:100%25\nglobal:literal%250Atext\nuser:odd%0D%0Aalias');
    expect(parseAliasBatchFooterIds(footerText)).toEqual([
      'user:100%',
      'global:literal%0Atext',
      'user:odd\r\nalias',
    ]);

    const confirmInteraction = createButtonInteraction({
      footerText,
    });
    await handleAliasBatchConfirm(confirmInteraction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(3);
    expect(mockUserClient.removePersonalityAlias).toHaveBeenNthCalledWith(1, 'lilith', '100%', {
      scope: 'user',
    });
    expect(mockUserClient.removePersonalityAlias).toHaveBeenNthCalledWith(
      2,
      'nyx',
      'literal%0Atext',
      { scope: 'global' }
    );
    expect(mockUserClient.removePersonalityAlias).toHaveBeenNthCalledWith(
      3,
      'lila-elyona',
      'odd\r\nalias',
      { scope: 'user' }
    );
  });

  it('round-trips an alias containing a bare carriage return and one containing CRLF through the codec and removal (C4)', async () => {
    const crRow = makeAliasRow({
      alias: 'odd\ralias',
      scope: 'user',
      character: { name: 'Lilith', slug: 'lilith' },
    });
    const crlfRow = makeAliasRow({
      alias: 'odd\r\nalias',
      scope: 'global',
      character: { name: 'Nyx', slug: 'nyx' },
    });
    const rows = [crRow, crlfRow];
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload(rows));
    mockUserClient.removePersonalityAlias.mockImplementation(
      (slug: string, alias: string, opts: { scope?: string }) =>
        Promise.resolve({
          ok: true,
          status: 200,
          data: { removedAlias: alias, removedScope: opts.scope ?? 'user', slug },
        })
    );

    const swapped = buildAliasBatchSelectComponents(rows, DEFAULT_COORDS);
    const pickInteraction = createSelectInteraction({
      values: rows.map(formatAliasSelectValue),
      messageComponents: swapped,
    });

    await handleAliasBatchPick(pickInteraction);

    const [confirmEmbed] = editReplyEmbeds(pickInteraction);
    const footerText = confirmEmbed.footer?.text;
    expect(footerText).toBe('user:odd%0Dalias\nglobal:odd%0D%0Aalias');
    expect(parseAliasBatchFooterIds(footerText)).toEqual([
      'user:odd\ralias',
      'global:odd\r\nalias',
    ]);

    const confirmInteraction = createButtonInteraction({ footerText });
    await handleAliasBatchConfirm(confirmInteraction);

    expect(mockUserClient.removePersonalityAlias).toHaveBeenCalledTimes(2);
    expect(mockUserClient.removePersonalityAlias).toHaveBeenNthCalledWith(
      1,
      'lilith',
      'odd\ralias',
      { scope: 'user' }
    );
    expect(mockUserClient.removePersonalityAlias).toHaveBeenNthCalledWith(
      2,
      'nyx',
      'odd\r\nalias',
      { scope: 'global' }
    );
  });

  it('decodes a lowercase %0a escape to a newline — the decoder guard is case-insensitive (C4)', () => {
    expect(parseAliasBatchFooterIds('user:odd%0aalias')).toEqual(['user:odd\nalias']);
  });
});

describe('C6 — footer budget guard (1900 chars)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not trip exceedsBatchFooterBudget for 15 non-ASCII aliases (~20 non-Latin chars each) at max page size', async () => {
    const nonAsciiRows = Array.from({ length: 15 }, (_, idx) =>
      makeAliasRow({
        alias: `${'שלוםעולםשלוםעולםשלום'}-${idx}`,
        scope: idx % 2 === 0 ? 'user' : 'global',
      })
    );
    const values = nonAsciiRows.map(formatAliasSelectValue);
    const encoded = encodeAliasBatchFooterIds(values);
    expect(exceedsBatchFooterBudget(encoded)).toBe(false);
    expect(encoded.length).toBeLessThanOrEqual(MAX_BATCH_FOOTER_LENGTH);

    const swapped = buildAliasBatchSelectComponents(nonAsciiRows, DEFAULT_COORDS);
    const pickInteraction = createSelectInteraction({
      values,
      messageComponents: swapped,
    });
    await handleAliasBatchPick(pickInteraction);

    expect(pickInteraction.followUp).not.toHaveBeenCalled();
    const [confirmEmbed] = editReplyEmbeds(pickInteraction);
    expect(parseAliasBatchFooterIds(confirmEmbed.footer?.text)).toEqual(values);
  });

  it('refuses with validation copy and makes zero gateway calls when encoded footer exceeds 1900 chars (C6)', async () => {
    // 15 aliases with newline/unicode chars whose escaped representation exceeds 1900 chars.
    const heavyValues = Array.from({ length: 15 }, (_, idx) => `user:${'é\n'.repeat(40)}${idx}`);
    const encoded = encodeAliasBatchFooterIds(heavyValues);
    expect(encoded.length).toBeGreaterThan(MAX_BATCH_FOOTER_LENGTH);

    const pickInteraction = createSelectInteraction({
      values: heavyValues,
    });
    await handleAliasBatchPick(pickInteraction);

    expect(pickInteraction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('too large to confirm'),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(pickInteraction.editReply).not.toHaveBeenCalled();
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();

    const confirmInteraction = createButtonInteraction({
      footerText: encoded,
    });
    await handleAliasBatchConfirm(confirmInteraction);

    expect(confirmInteraction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('too large to confirm'),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(mockUserClient.listMyAliases).not.toHaveBeenCalled();
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
  });

  it('refuses with validation copy and makes zero gateway calls when confirm message footer text exceeds MAX_BATCH_FOOTER_LENGTH', async () => {
    const oversizedFooter = `user:${'a'.repeat(MAX_BATCH_FOOTER_LENGTH)}`;
    expect(oversizedFooter.length).toBeGreaterThan(MAX_BATCH_FOOTER_LENGTH);

    const confirmInteraction = createButtonInteraction({
      footerText: oversizedFooter,
    });
    await handleAliasBatchConfirm(confirmInteraction);

    expect(confirmInteraction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('too large to confirm'),
        flags: MessageFlags.Ephemeral,
      })
    );
    expect(confirmInteraction.editReply).not.toHaveBeenCalled();
    expect(mockUserClient.listMyAliases).not.toHaveBeenCalled();
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
  });
});

describe('handleAliasBatchCancel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUserClient.listMyAliases.mockResolvedValue(myAliasesPayload(FIVE_ROWS));
  });

  it('cancel returns to the normal browse view at the carried coordinates without removing', async () => {
    const interaction = createButtonInteraction({
      customId: 'character-alias::batch-cancel::0::all::',
    });

    await handleAliasBatchCancel(interaction);

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(mockUserClient.removePersonalityAlias).not.toHaveBeenCalled();
    const [embed] = editReplyEmbeds(interaction);
    expect(embed.title).toBe('🏷️ Aliases');
  });

  it('routes batch-cancel through handleButton', async () => {
    const cancelViaRouter = createButtonInteraction({
      customId: 'character-alias::batch-cancel::0::all::',
    });
    await handleButton(cancelViaRouter);
    expect(editReplyEmbeds(cancelViaRouter)[0]?.title).toBe('🏷️ Aliases');
  });
});
