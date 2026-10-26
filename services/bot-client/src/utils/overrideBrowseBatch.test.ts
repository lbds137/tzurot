/**
 * Tests for the shared override browser batch clear flow (overrideBrowseBatch.ts).
 *
 * Covers Canaries C1–C5, envelope branching (ok / wasSet:false / any !ok incl. 404 / throw),
 * ack-first and component-strip-first ordering, cancel, error paths, customId length
 * ceiling, and the survival ladder.
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
import type { UserClient } from '@tzurot/clients';
import type { ModelSlot } from '@tzurot/common-types/constants/ai';
import type { DeleteModelOverrideResponse } from '@tzurot/common-types/schemas/api/model-override';
import { DISCORD_COLORS, DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { makeOk, makeErr } from '../test/gatewayClientStubs.js';
import {
  type OverrideBrowseConfig,
  type OverrideSummary,
  GENERIC_ERROR_MSG,
  errorReply,
  buildOverrideBrowseView,
  createOverrideBrowseCustomIds,
  formatOverrideSelectValue,
  handleOverrideBrowseButton,
  handleOverrideBrowseSelect,
} from './overrideBrowse.js';
import {
  FAILED_TO_CLEAR_NOTE,
  buildRefreshedOverrideView,
  fallbackOverrideLabel,
  handleOverrideBatchButton,
  handleOverrideBatchCancel,
  handleOverrideBatchConfirm,
  handleOverrideBatchPick,
  handleOverrideBatchSelectEntry,
  isOverrideBatchButton,
} from './overrideBrowseBatch.js';
import { encodeBatchFooterIds, parseBatchFooterIds } from './browse/multiSelectBatch.js';

const stub = {
  list: vi.fn(),
  delete: vi.fn(),
};

vi.mock('./gatewayClients.js', () => ({
  clientsFor: vi.fn(() => ({ userClient: {} as unknown as UserClient })),
}));

vi.mock('@tzurot/common-types/utils/logger', async () => {
  const actual = await vi.importActual<typeof import('@tzurot/common-types/utils/logger')>(
    '@tzurot/common-types/utils/logger'
  );
  return {
    ...actual,
    createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  };
});

const PRESET_PREFIX = 'settings-preset-override';
const TTS_PREFIX = 'voice-tts-override';

function makeConfig(prefix = PRESET_PREFIX): OverrideBrowseConfig {
  const isTts = prefix === TTS_PREFIX;
  return {
    prefix,
    entityEmoji: isTts ? '🎤' : '⚙️',
    titleNoun: isTts ? 'TTS Overrides' : 'Preset Overrides',
    entityType: isTts ? 'TTS override' : 'preset override',
    fallbackNoun: isTts ? 'TTS config' : 'preset',
    emptyDescription: 'No overrides set.',
    clearCommandHint: isTts ? '/voice tts clear' : '/preset override clear',
    selectPlaceholder: 'Select an override to clear…',
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as never,
    list: () => stub.list() as ReturnType<OverrideBrowseConfig['list']>,
    delete: (_uc, id, slot) => stub.delete(id, slot) as ReturnType<OverrideBrowseConfig['delete']>,
  };
}

function makeOverride(
  id: string,
  name: string,
  configName: string | null = 'Fast',
  slot?: ModelSlot,
  supportsVision?: boolean
): OverrideSummary {
  return { personalityId: id, personalityName: name, configName, slot, supportsVision };
}

const FIVE_PRESET_OVERRIDES: OverrideSummary[] = [
  makeOverride('p1', 'Lilith', 'Claude Sonnet', 'text', false),
  makeOverride('p2', 'Aria', 'GPT-4o', 'vision', true),
  makeOverride('p3', 'Nyx', 'DeepSeek', 'text', false),
  makeOverride('p4', 'Raven', 'Gemini Pro', 'vision', true),
  makeOverride('p5', 'Selene', 'Haiku', 'text', false),
];

function createButtonInteraction(options: {
  customId: string;
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
    user: { id: 'u1' },
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
  messageComponents?: unknown[];
}): StringSelectMenuInteraction {
  return {
    user: { id: 'u1' },
    customId: options.customId,
    values: options.values,
    deferred: false,
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

beforeEach(() => {
  vi.clearAllMocks();
  stub.list.mockReset();
  stub.delete.mockReset();
});

describe('C3 — real multi-select swap render & handleOverrideBatchSelectEntry', () => {
  it('renders a multi-select with min 1, max = min(25, count), batch-select customId, Cancel button, and NO pagination row (C3)', () => {
    const config = makeConfig(PRESET_PREFIX);
    const view = buildOverrideBrowseView(config, FIVE_PRESET_OVERRIDES, { mode: 'batch' });

    // Exactly 2 rows: the multi-select row + the Cancel button row (no pagination row).
    expect(view.components).toHaveLength(2);
    const [selectRow, cancelRow] = view.components.map(row => row.toJSON().components);

    expect(selectRow).toHaveLength(1);
    const selectMenu = selectRow[0] as unknown as {
      custom_id: string;
      min_values: number;
      max_values: number;
      options: { value: string; label: string }[];
    };
    expect(selectMenu.custom_id).toBe('settings-preset-override::batch-select');
    expect(selectMenu.min_values).toBe(1);
    expect(selectMenu.max_values).toBe(5);
    expect(selectMenu.options.map(o => o.value)).toEqual(
      FIVE_PRESET_OVERRIDES.map(formatOverrideSelectValue)
    );

    expect(cancelRow).toHaveLength(1);
    expect(cancelRow[0]).toMatchObject({
      custom_id: 'settings-preset-override::batch-cancel',
      label: 'Cancel',
    });

    // When >25 rows exist, max_values caps at 25 (SELECT_LIMIT).
    const thirtyOverrides = Array.from({ length: 30 }, (_, i) =>
      makeOverride(`p-${i}`, `Char ${i}`, 'Cfg', 'text')
    );
    const cappedView = buildOverrideBrowseView(config, thirtyOverrides, { mode: 'batch' });
    expect(cappedView.components).toHaveLength(2);
    const cappedMenu = cappedView.components[0].toJSON().components[0] as unknown as {
      min_values: number;
      max_values: number;
      options: unknown[];
    };
    expect(cappedMenu.min_values).toBe(1);
    expect(cappedMenu.max_values).toBe(25);
    expect(cappedMenu.options).toHaveLength(25);
  });

  it('acks first, fetches overrides, and swaps the view into multi-select mode on batch-select click', async () => {
    stub.list.mockResolvedValue(FIVE_PRESET_OVERRIDES);
    const interaction = createButtonInteraction({
      customId: 'settings-preset-override::batch-select',
    });

    await handleOverrideBatchSelectEntry(makeConfig(PRESET_PREFIX), interaction);

    const deferOrder = vi.mocked(interaction.deferUpdate).mock.invocationCallOrder[0];
    const listOrder = stub.list.mock.invocationCallOrder[0];
    expect(deferOrder).toBeLessThan(listOrder);

    const rows = lastComponentRows(interaction);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toMatchObject({
      custom_id: 'settings-preset-override::batch-select',
      min_values: 1,
      max_values: 5,
    });
    expect(rows[1][0]).toMatchObject({
      custom_id: 'settings-preset-override::batch-cancel',
      label: 'Cancel',
    });
  });

  it('shows the load-failure error when config.list returns null on batch-select entry', async () => {
    stub.list.mockResolvedValue(null);
    const interaction = createButtonInteraction({
      customId: 'settings-preset-override::batch-select',
    });

    await handleOverrideBatchSelectEntry(makeConfig(PRESET_PREFIX), interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ Failed to load overrides. Please try again later.',
      embeds: [],
      components: [],
    });
  });
});

describe('C4 — footer round-trip, slot-bearing', () => {
  it('encodes and parses mixed bare personalityId + personalityId::slot values losslessly (C4)', () => {
    const mixedValues = [
      '3f9c2e7a-8b4d-4c1a-9d6e-000000000001::text',
      '3f9c2e7a-8b4d-4c1a-9d6e-000000000001::vision',
      '9a8b7c6d-5e4f-3a2b-1c0d-000000000002',
      'p3::text',
      'p4',
    ];
    const encoded = encodeBatchFooterIds(mixedValues);
    expect(encoded).toBe(mixedValues.join('\n'));
    expect(encoded.length).toBeLessThan(DISCORD_LIMITS.EMBED_FOOTER);
    expect(parseBatchFooterIds(encoded)).toEqual(mixedValues);
  });

  it('returns null for absent or empty footer text', () => {
    expect(parseBatchFooterIds(undefined)).toBeNull();
    expect(parseBatchFooterIds('')).toBeNull();
    expect(parseBatchFooterIds('\n\n')).toBeNull();
  });
});

describe('handleOverrideBatchPick (confirm view)', () => {
  it('acks first, reads option labels from the attached select menu, and renders Clear (N) (Danger, last) + Cancel', async () => {
    const config = makeConfig(PRESET_PREFIX);
    const batchView = buildOverrideBrowseView(config, FIVE_PRESET_OVERRIDES, { mode: 'batch' });
    const pickedValues = ['p1::text', 'p2::vision'];
    const interaction = createSelectInteraction({
      customId: 'settings-preset-override::batch-select',
      values: pickedValues,
      messageComponents: batchView.components,
    });

    await handleOverrideBatchPick(config, interaction);

    expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
    const [embed] = lastEmbedsJson(interaction);
    expect(embed.title).toBe('⚙️ Clear Preset Overrides?');
    expect(embed.description).toContain('1. Lilith');
    expect(embed.description).toContain('2. 👁️ Aria');
    expect(embed.description).not.toContain('Nyx');
    expect(embed.description).toContain('**This clears 2 preset overrides immediately.**');
    expect(embed.description).toContain(
      'Cleared overrides will fall back to your default preset. You can re-set them any time.'
    );
    expect(embed.description).not.toContain('Cleared characters');
    expect(parseBatchFooterIds(embed.footer?.text)).toEqual(pickedValues);

    const rows = lastComponentRows(interaction);
    expect(rows).toHaveLength(1);
    const [cancelBtn, clearBtn] = rows[0] as {
      custom_id?: string;
      label?: string;
      style?: number;
    }[];
    expect(cancelBtn.custom_id).toBe('settings-preset-override::batch-cancel');
    expect(cancelBtn.label).toBe('Cancel');
    expect(cancelBtn.style).toBe(ButtonStyle.Secondary);
    expect(clearBtn.custom_id).toBe('settings-preset-override::batch-confirm');
    expect(clearBtn.label).toBe('Clear (2)');
    expect(clearBtn.style).toBe(ButtonStyle.Danger);
  });

  it('shows an error when no values are selected', async () => {
    const interaction = createSelectInteraction({
      customId: 'settings-preset-override::batch-select',
      values: [],
    });

    await handleOverrideBatchPick(makeConfig(PRESET_PREFIX), interaction);

    expect(interaction.editReply).toHaveBeenCalledWith({
      content: '❌ No overrides were selected.',
      embeds: [],
      components: [],
    });
  });

  it('omits the slot suffix on a confirm listing line when the option value carries an unknown slot segment', async () => {
    const config = makeConfig(PRESET_PREFIX);
    const interaction = createSelectInteraction({
      customId: 'settings-preset-override::batch-select',
      values: ['p1::bogus'],
      messageComponents: [
        {
          toJSON: () => ({
            components: [{ options: [{ value: 'p1::bogus', label: '1. Lilith' }] }],
          }),
        },
      ],
    });

    await handleOverrideBatchPick(config, interaction);

    const [embed] = lastEmbedsJson(interaction);
    const listingBlock = (embed.description ?? '').split('\n\n')[0];
    expect(listingBlock).toBe('• 1. Lilith');
    expect(listingBlock).not.toContain('bogus');
  });
});

describe('C1 — handleOverrideBatchConfirm (5 overrides, 4 cleared + 2nd wasSet:false → #2 already-gone, all 5 reached)', () => {
  it('reaches all 5 overrides when #2 was already unset, naming #2 already gone and the other 4 succeeded (C1)', async () => {
    const config = makeConfig(PRESET_PREFIX);
    stub.list.mockResolvedValue([]);
    stub.delete.mockImplementation((id: string) => {
      if (id === 'p2') {
        return Promise.resolve(
          makeOk({ deleted: true, wasSet: false } satisfies DeleteModelOverrideResponse)
        );
      }
      return Promise.resolve(
        makeOk({ deleted: true, wasSet: true } satisfies DeleteModelOverrideResponse)
      );
    });

    const batchView = buildOverrideBrowseView(config, FIVE_PRESET_OVERRIDES, { mode: 'batch' });
    const pickedValues = FIVE_PRESET_OVERRIDES.map(formatOverrideSelectValue);
    const pickInteraction = createSelectInteraction({
      customId: 'settings-preset-override::batch-select',
      values: pickedValues,
      messageComponents: batchView.components,
    });
    await handleOverrideBatchPick(config, pickInteraction);
    const [confirmEmbed] = lastEmbedsJson(pickInteraction);

    const confirmInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: confirmEmbed.footer?.text,
      description: confirmEmbed.description,
    });

    await handleOverrideBatchConfirm(config, confirmInteraction);

    expect(stub.delete).toHaveBeenCalledTimes(5);
    expect(stub.delete).toHaveBeenNthCalledWith(1, 'p1', 'text');
    expect(stub.delete).toHaveBeenNthCalledWith(2, 'p2', 'vision');
    expect(stub.delete).toHaveBeenNthCalledWith(3, 'p3', 'text');
    expect(stub.delete).toHaveBeenNthCalledWith(4, 'p4', 'vision');
    expect(stub.delete).toHaveBeenNthCalledWith(5, 'p5', 'text');

    const [resultEmbed, refreshedEmbed] = lastEmbedsJson(confirmInteraction);
    expect(resultEmbed.description).toContain('✅ 1. Lilith');
    expect(resultEmbed.description).toContain('◻️ 2. 👁️ Aria (vision) — already gone');
    expect(resultEmbed.description).toContain('✅ 3. Nyx');
    expect(resultEmbed.description).toContain('✅ 4. 👁️ Raven');
    expect(resultEmbed.description).toContain('✅ 5. Selene');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.SUCCESS);
    expect(refreshedEmbed.title).toBe('⚙️ Preset Overrides');
  });

  it('maps an idempotent 200 { deleted: true, wasSet: false } response to already gone', async () => {
    const config = makeConfig(TTS_PREFIX);
    stub.list.mockResolvedValue([]);
    stub.delete.mockResolvedValue(
      makeOk({ deleted: true, wasSet: false } satisfies DeleteModelOverrideResponse)
    );

    const confirmInteraction = createButtonInteraction({
      customId: 'voice-tts-override::batch-confirm',
      footerText: encodeBatchFooterIds(['p1']),
    });

    await handleOverrideBatchConfirm(config, confirmInteraction);

    expect(stub.delete).toHaveBeenCalledWith('p1', undefined);
    const [resultEmbed] = lastEmbedsJson(confirmInteraction);
    expect(resultEmbed.description).toContain('◻️ Override ID: p1… — already gone');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.WARNING);
  });

  it('isolates a 404 (not proof of absence) and a thrown error as failures, continuing to all remaining items', async () => {
    const config = makeConfig(PRESET_PREFIX);
    stub.list.mockResolvedValue([]);
    stub.delete.mockImplementation((id: string) => {
      if (id === 'p2') {
        return Promise.resolve(makeErr(404, 'Not found'));
      }
      if (id === 'p4') {
        return Promise.reject(new Error('network reset'));
      }
      return Promise.resolve(makeOk({ deleted: true }));
    });

    const pickedValues = FIVE_PRESET_OVERRIDES.map(formatOverrideSelectValue);
    const confirmInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: encodeBatchFooterIds(pickedValues),
    });

    await handleOverrideBatchConfirm(config, confirmInteraction);

    expect(stub.delete).toHaveBeenCalledTimes(5);
    const [resultEmbed] = lastEmbedsJson(confirmInteraction);
    const lines = (resultEmbed.description ?? '').split('\n');
    expect(lines[0]).toBe('✅ Override ID: p1… (text)');
    expect(lines[1]).toBe(`❌ Override ID: p2… (vision) — ${FAILED_TO_CLEAR_NOTE}`);
    // Single ❌ glyph on the failed line (not doubled).
    expect(lines[1].match(/❌/g)).toHaveLength(1);
    expect(lines[2]).toBe('✅ Override ID: p3… (text)');
    expect(lines[3]).toBe(`❌ Override ID: p4… (vision) — ${FAILED_TO_CLEAR_NOTE}`);
    expect(lines[4]).toBe('✅ Override ID: p5… (text)');
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);
  });

  it('logs each failed item with ids only: a !ok result carries its status, a throw carries the error', async () => {
    const config = makeConfig(PRESET_PREFIX);
    stub.list.mockResolvedValue([]);
    const thrown = new Error('network reset');
    stub.delete.mockImplementation((id: string) => {
      if (id === 'p2') {
        return Promise.resolve(makeErr(503, 'Unavailable'));
      }
      if (id === 'p4') {
        return Promise.reject(thrown);
      }
      return Promise.resolve(makeOk({ deleted: true }));
    });

    const confirmInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: encodeBatchFooterIds(['p2::vision', 'p4::text', 'p5::text']),
    });

    await handleOverrideBatchConfirm(config, confirmInteraction);

    expect(config.logger.warn).toHaveBeenCalledWith(
      { userId: 'u1', personalityId: 'p2', slot: 'vision', status: 503 },
      'Batch override clear item failed'
    );
    expect(config.logger.warn).toHaveBeenCalledWith(
      { err: thrown, userId: 'u1', personalityId: 'p4', slot: 'text' },
      'Batch override clear item threw'
    );
  });

  it('strips confirm components BEFORE any delete call and guards against double-ack', async () => {
    const config = makeConfig(PRESET_PREFIX);
    stub.list.mockResolvedValue([]);
    stub.delete.mockResolvedValue(makeOk({ deleted: true }));

    const confirmInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: encodeBatchFooterIds(['p1::text']),
      deferred: true,
    });

    await handleOverrideBatchConfirm(config, confirmInteraction);

    // Already deferred → deferUpdate not called a second time.
    expect(confirmInteraction.deferUpdate).not.toHaveBeenCalled();
    expect(vi.mocked(confirmInteraction.editReply).mock.calls[0]?.[0]).toEqual({ components: [] });
    const stripOrder = vi.mocked(confirmInteraction.editReply).mock.invocationCallOrder[0];
    const deleteOrder = stub.delete.mock.invocationCallOrder[0];
    expect(stripOrder).toBeLessThan(deleteOrder);
  });

  it('shows an error without calling delete when the confirm footer is missing or empty', async () => {
    const config = makeConfig(PRESET_PREFIX);
    const confirmInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
    });

    await handleOverrideBatchConfirm(config, confirmInteraction);

    expect(stub.delete).not.toHaveBeenCalled();
    expect(confirmInteraction.editReply).toHaveBeenCalledWith({
      content: '❌ Could not determine which overrides were selected. Please try again.',
      embeds: [],
      components: [],
    });
  });

  it('answers on an ephemeral followUp and makes no delete call when stripping the confirm components throws', async () => {
    const config = makeConfig(PRESET_PREFIX);
    const confirmInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: encodeBatchFooterIds(['p1::text']),
    });
    vi.mocked(confirmInteraction.editReply).mockRejectedValueOnce(new Error('strip failed'));

    await handleOverrideBatchConfirm(config, confirmInteraction);

    expect(stub.delete).not.toHaveBeenCalled();
    expect(confirmInteraction.followUp).toHaveBeenCalledWith({
      content: GENERIC_ERROR_MSG,
      flags: MessageFlags.Ephemeral,
    });
    expect(config.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      expect.any(String)
    );
  });

  it('resolves without throwing and makes no delete call when both the strip and the error followUp reject', async () => {
    const config = makeConfig(PRESET_PREFIX);
    const confirmInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: encodeBatchFooterIds(['p1::text']),
    });
    vi.mocked(confirmInteraction.editReply).mockRejectedValueOnce(new Error('strip failed'));
    vi.mocked(confirmInteraction.followUp).mockRejectedValueOnce(new Error('followUp failed'));

    await expect(handleOverrideBatchConfirm(config, confirmInteraction)).resolves.toBeUndefined();

    expect(stub.delete).not.toHaveBeenCalled();
    expect(confirmInteraction.followUp).toHaveBeenCalledTimes(1);
    expect(config.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      expect.any(String)
    );
  });

  it('catches a rejecting ackUpdate/deferUpdate in handleOverrideBatchConfirm, makes no delete call, and sends an ephemeral error followUp (C6)', async () => {
    const config = makeConfig(PRESET_PREFIX);
    const confirmInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: encodeBatchFooterIds(['p1::text']),
    });
    vi.mocked(confirmInteraction.deferUpdate).mockRejectedValueOnce(new Error('ack rejected'));

    await expect(handleOverrideBatchConfirm(config, confirmInteraction)).resolves.toBeUndefined();

    expect(stub.delete).not.toHaveBeenCalled();
    expect(confirmInteraction.editReply).not.toHaveBeenCalled();
    expect(confirmInteraction.followUp).toHaveBeenCalledWith({
      content: GENERIC_ERROR_MSG,
      flags: MessageFlags.Ephemeral,
    });
    expect(config.logger.error).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      'Error preparing override batch confirm'
    );

    // Also resolves cleanly and logs warn when both deferUpdate and followUp reject.
    const interaction2 = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: encodeBatchFooterIds(['p1::text']),
    });
    vi.mocked(interaction2.deferUpdate).mockRejectedValueOnce(new Error('ack rejected'));
    vi.mocked(interaction2.followUp).mockRejectedValueOnce(new Error('followUp rejected'));

    await expect(handleOverrideBatchConfirm(config, interaction2)).resolves.toBeUndefined();
    expect(stub.delete).not.toHaveBeenCalled();
    expect(config.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1' }),
      'Override batch confirm error followUp failed'
    );
  });

  it('fails closed for an unknown or empty slot segment in batch confirm, calling delete only for valid items and marking the unknown-slot item failed (C1, C4, C5)', async () => {
    const config = makeConfig(PRESET_PREFIX);
    stub.list.mockResolvedValue([]);
    stub.delete.mockResolvedValue(
      makeOk({ deleted: true, wasSet: true } satisfies DeleteModelOverrideResponse)
    );

    const uuidA = '3f9c2e7a-8b4d-4c1a-9d6e-000000000001';
    const uuidB = '9a8b7c6d-5e4f-3a2b-1c0d-000000000002';
    const confirmInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: encodeBatchFooterIds([`${uuidA}::text`, `${uuidB}::bogus`]),
    });

    await handleOverrideBatchConfirm(config, confirmInteraction);

    expect(stub.delete).toHaveBeenCalledTimes(1);
    expect(stub.delete).toHaveBeenCalledWith(uuidA, 'text');
    expect(stub.delete).not.toHaveBeenCalledWith(uuidB, expect.anything());
    expect(config.logger.warn).toHaveBeenCalledWith(
      { userId: 'u1', personalityId: uuidB },
      'Batch override clear item has unknown slot segment'
    );
    expect(JSON.stringify(vi.mocked(config.logger.warn).mock.calls)).not.toContain('bogus');

    const [resultEmbed] = lastEmbedsJson(confirmInteraction);
    const lines = (resultEmbed.description ?? '').split('\n');
    expect(lines).toEqual([
      '✅ Override ID: 3f9c2e7a… (text)',
      `❌ Override ID: 9a8b7c6d… — ${FAILED_TO_CLEAR_NOTE}`,
    ]);
    expect(resultEmbed.color).toBe(DISCORD_COLORS.ERROR);

    // C4 (bare TTS + vision slot) and C5 (empty slot segment `uuid::`) in one batch:
    stub.delete.mockClear();
    const uuidC = '11111111-2222-4333-8444-000000000003';
    const mixedConfirm = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: encodeBatchFooterIds([uuidA, `${uuidB}::vision`, `${uuidC}::`]),
    });
    await handleOverrideBatchConfirm(config, mixedConfirm);

    expect(stub.delete).toHaveBeenCalledTimes(2);
    expect(stub.delete).toHaveBeenNthCalledWith(1, uuidA, undefined);
    expect(stub.delete).toHaveBeenNthCalledWith(2, uuidB, 'vision');
    expect(stub.delete).not.toHaveBeenCalledWith(uuidC, expect.anything());
    const [mixedEmbed] = lastEmbedsJson(mixedConfirm);
    expect((mixedEmbed.description ?? '').split('\n')).toEqual([
      '✅ Override ID: 3f9c2e7a…',
      '✅ Override ID: 9a8b7c6d… (vision)',
      `❌ Override ID: 11111111… — ${FAILED_TO_CLEAR_NOTE}`,
    ]);
  });
});

describe('recovered labels reach the result lines as rendered at pick time', () => {
  async function runPickThenConfirm(
    overrides: OverrideSummary[]
  ): Promise<{ resultDescription: string }> {
    const config = makeConfig(PRESET_PREFIX);
    stub.list.mockResolvedValue([]);
    stub.delete.mockResolvedValue(
      makeOk({ deleted: true, wasSet: true } satisfies DeleteModelOverrideResponse)
    );
    const batchView = buildOverrideBrowseView(config, overrides, { mode: 'batch' });
    const pickInteraction = createSelectInteraction({
      customId: 'settings-preset-override::batch-select',
      values: overrides.map(formatOverrideSelectValue),
      messageComponents: batchView.components,
    });
    await handleOverrideBatchPick(config, pickInteraction);
    const [confirmEmbed] = lastEmbedsJson(pickInteraction);
    const confirmInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: confirmEmbed.footer?.text,
      description: confirmEmbed.description,
    });
    await handleOverrideBatchConfirm(config, confirmInteraction);
    const [resultEmbed] = lastEmbedsJson(confirmInteraction);
    return { resultDescription: resultEmbed.description ?? '' };
  }

  it('keeps the slot suffix intact on a 98-char option label (no second cut)', async () => {
    const longName = 'A'.repeat(95);
    const { resultDescription } = await runPickThenConfirm([
      makeOverride('p1', longName, 'Fast', 'vision', false),
    ]);

    expect(resultDescription).toContain(`✅ 1. ${longName} (vision)`);
  });

  it('does not double-escape markdown in a recovered label', async () => {
    const { resultDescription } = await runPickThenConfirm([
      makeOverride('p1', '*bold*', 'Fast', 'text', false),
    ]);

    expect(resultDescription).toContain('✅ 1. \\*bold\\* (text)');
    expect(resultDescription).not.toContain('\\\\');
  });

  it('recovers the matched prefix of labels (excluding the last potentially-cut line) when the confirm listing is clamped (C7)', async () => {
    // The 25 markdown-heavy labels clamp inside the LAST line so the line count still matches ids.length.
    const twentyFiveMarkdownHeavy = Array.from({ length: 25 }, (_, idx) =>
      makeOverride(`p-${idx + 1}`, `${'*_~'.repeat(27)}${idx + 1}`, 'Fast', 'text', false)
    );
    const { resultDescription } = await runPickThenConfirm(twentyFiveMarkdownHeavy);
    const resultLines = resultDescription.split('\n');
    expect(resultLines).toHaveLength(25);
    expect(resultLines[0]).toContain('✅ 1. ');
    expect(resultLines[0]).toContain('(text)');
    expect(resultLines[24]).toBe('✅ Override ID: p-25… (text)');
  });

  it('strips embedded newlines from a picked option label so it renders as one bullet line and every later label recovers onto its own id', async () => {
    const config = makeConfig(PRESET_PREFIX);
    stub.list.mockResolvedValue([]);
    stub.delete.mockResolvedValue(
      makeOk({ deleted: true, wasSet: true } satisfies DeleteModelOverrideResponse)
    );

    const pickInteraction = createSelectInteraction({
      customId: 'settings-preset-override::batch-select',
      values: ['p1::text', 'p2::vision'],
      messageComponents: [
        {
          toJSON: () => ({
            components: [
              {
                options: [
                  { value: 'p1::text', label: '1. Alpha\n• Injected' },
                  { value: 'p2::vision', label: '2. 👁️ Beta' },
                ],
              },
            ],
          }),
        },
      ],
    });
    await handleOverrideBatchPick(config, pickInteraction);
    const [confirmEmbed] = lastEmbedsJson(pickInteraction);
    const listingLines = (confirmEmbed.description ?? '').split('\n\n')[0]?.split('\n');
    expect(listingLines).toEqual(['• 1. Alpha • Injected (text)', '• 2. 👁️ Beta (vision)']);

    const confirmInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: confirmEmbed.footer?.text,
      description: confirmEmbed.description,
    });
    await handleOverrideBatchConfirm(config, confirmInteraction);
    const [resultEmbed] = lastEmbedsJson(confirmInteraction);
    expect((resultEmbed.description ?? '').split('\n')).toEqual([
      '✅ 1. Alpha • Injected (text)',
      '✅ 2. 👁️ Beta (vision)',
    ]);

    // Under clamped recovery (25 items), an embedded `\n• ` on item 1 must not shift item 2's label onto id 3.
    const clampedValues = Array.from({ length: 25 }, (_, idx) => `p-${idx + 1}::text`);
    const clampedPick = createSelectInteraction({
      customId: 'settings-preset-override::batch-select',
      values: clampedValues,
      messageComponents: [
        {
          toJSON: () => ({
            components: [
              {
                options: clampedValues.map((value, idx) => ({
                  value,
                  label:
                    idx === 0
                      ? '1. Alpha\n• Injected'
                      : idx === 1
                        ? '2. Second Label'
                        : `${idx + 1}. ${'*_~'.repeat(27)}${idx + 1}`,
                })),
              },
            ],
          }),
        },
      ],
    });
    await handleOverrideBatchPick(config, clampedPick);
    const [clampedConfirmEmbed] = lastEmbedsJson(clampedPick);
    const clampedConfirm = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: clampedConfirmEmbed.footer?.text,
      description: clampedConfirmEmbed.description,
    });
    await handleOverrideBatchConfirm(config, clampedConfirm);
    const [clampedResultEmbed] = lastEmbedsJson(clampedConfirm);
    const clampedResultLines = (clampedResultEmbed.description ?? '').split('\n');
    expect(clampedResultLines[0]).toBe('✅ 1. Alpha • Injected (text)');
    expect(clampedResultLines[1]).toBe('✅ 2. Second Label (text)');
  });
});

describe('C5 — slot axis survives the batch (same personality with two slots + bare TTS pick)', () => {
  it('clears each slot independently for two picks of the SAME personality and clears bare for TTS (C5)', async () => {
    stub.list.mockResolvedValue([]);
    stub.delete.mockResolvedValue(makeOk({ deleted: true }));

    // Preset batch: same personalityId 'p1' picked for both 'text' and 'vision' slots.
    const presetConfig = makeConfig(PRESET_PREFIX);
    const sameCharOverrides = [
      makeOverride('p1', 'Lilith', 'Text Preset', 'text', false),
      makeOverride('p1', 'Lilith', 'Vision Preset', 'vision', true),
    ];
    const batchView = buildOverrideBrowseView(presetConfig, sameCharOverrides, { mode: 'batch' });
    const pickInteraction = createSelectInteraction({
      customId: 'settings-preset-override::batch-select',
      values: ['p1::text', 'p1::vision'],
      messageComponents: batchView.components,
    });
    await handleOverrideBatchPick(presetConfig, pickInteraction);
    const [confirmEmbed] = lastEmbedsJson(pickInteraction);

    // The confirm listing tells the two slots of the same character apart.
    const listingLines = (confirmEmbed.description ?? '').split('\n\n')[0].split('\n');
    expect(listingLines).toEqual(['• 1. Lilith (text)', '• 2. 👁️ Lilith (vision)']);

    const presetConfirm = createButtonInteraction({
      customId: 'settings-preset-override::batch-confirm',
      footerText: confirmEmbed.footer?.text,
      description: confirmEmbed.description,
    });
    await handleOverrideBatchConfirm(presetConfig, presetConfirm);

    // The result lines carry the same slot suffix, once each.
    const [presetResultEmbed] = lastEmbedsJson(presetConfirm);
    expect((presetResultEmbed.description ?? '').split('\n')).toEqual([
      '✅ 1. Lilith (text)',
      '✅ 2. 👁️ Lilith (vision)',
    ]);

    expect(stub.delete).toHaveBeenCalledTimes(2);
    expect(stub.delete).toHaveBeenNthCalledWith(1, 'p1', 'text');
    expect(stub.delete).toHaveBeenNthCalledWith(2, 'p1', 'vision');

    // TTS batch: bare personalityId 'p1' clears with slot === undefined.
    stub.delete.mockClear();
    const ttsConfig = makeConfig(TTS_PREFIX);
    const ttsConfirm = createButtonInteraction({
      customId: 'voice-tts-override::batch-confirm',
      footerText: encodeBatchFooterIds(['p1']),
    });
    await handleOverrideBatchConfirm(ttsConfig, ttsConfirm);

    expect(stub.delete).toHaveBeenCalledTimes(1);
    expect(stub.delete).toHaveBeenCalledWith('p1', undefined);
  });
});

describe('C2 — one-pick path unchanged alongside batch routing', () => {
  it('keeps single-select -> single-confirm -> single-clear unchanged while batch tokens route to batch handlers', async () => {
    const config = makeConfig(PRESET_PREFIX);
    stub.list.mockResolvedValue([makeOverride('p1', 'Lilith', 'Fast', 'text')]);
    stub.delete.mockResolvedValue(makeOk({ deleted: true }));

    // Single select -> single confirm
    const singleSelect = createSelectInteraction({
      customId: 'settings-preset-override::select',
      values: ['p1::text'],
    });
    await handleOverrideBrowseSelect(config, singleSelect);
    const [singleConfirmEmbed] = lastEmbedsJson(singleSelect);
    expect(singleConfirmEmbed.title).toBe('Clear preset override?');

    // Single clear button -> single delete
    const singleClear = createButtonInteraction({
      customId: 'settings-preset-override::clear::p1::text',
    });
    await handleOverrideBrowseButton(config, singleClear);
    expect(stub.delete).toHaveBeenCalledWith('p1', 'text');
  });
});

describe('handleOverrideBatchCancel & handleOverrideBatchButton routing', () => {
  it('refreshes the single-select browse view without deleting on batch-cancel', async () => {
    const config = makeConfig(PRESET_PREFIX);
    stub.list.mockResolvedValue([makeOverride('p1', 'Lilith', 'Fast', 'text')]);

    const cancelInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-cancel',
    });
    await handleOverrideBatchButton(config, cancelInteraction);

    expect(cancelInteraction.deferUpdate).toHaveBeenCalledTimes(1);
    expect(stub.delete).not.toHaveBeenCalled();
    const [embed] = lastEmbedsJson(cancelInteraction);
    expect(embed.title).toBe('⚙️ Preset Overrides');
    const rows = lastComponentRows(cancelInteraction);
    expect(rows).toHaveLength(2);
    expect(rows[0][0]).toMatchObject({ custom_id: 'settings-preset-override::select' });
    expect(rows[1][0]).toMatchObject({ custom_id: 'settings-preset-override::batch-select' });
  });

  it('shows the load error when config.list returns null on batch-cancel', async () => {
    stub.list.mockResolvedValue(null);
    const cancelInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-cancel',
    });

    await handleOverrideBatchCancel(makeConfig(PRESET_PREFIX), cancelInteraction);

    expect(cancelInteraction.editReply).toHaveBeenCalledWith({
      content: '❌ Failed to load overrides. Please try again later.',
      embeds: [],
      components: [],
    });
  });

  it('answers with the generic error and does not throw when config.list throws on batch-cancel', async () => {
    stub.list.mockRejectedValue(new Error('list exploded'));
    const config = makeConfig(PRESET_PREFIX);
    const cancelInteraction = createButtonInteraction({
      customId: 'settings-preset-override::batch-cancel',
    });

    await expect(handleOverrideBatchCancel(config, cancelInteraction)).resolves.toBeUndefined();

    expect(cancelInteraction.editReply).toHaveBeenCalledWith(errorReply(GENERIC_ERROR_MSG));
  });

  it('answers with the generic error and does not throw when config.list throws on batch-select entry', async () => {
    stub.list.mockRejectedValue(new Error('list exploded'));
    const config = makeConfig(PRESET_PREFIX);
    const interaction = createButtonInteraction({
      customId: 'settings-preset-override::batch-select',
    });

    await expect(handleOverrideBatchSelectEntry(config, interaction)).resolves.toBeUndefined();

    expect(interaction.editReply).toHaveBeenCalledWith(errorReply(GENERIC_ERROR_MSG));
  });

  it('logs a debug line and does nothing else for a customId no batch action claims', async () => {
    const config = makeConfig(PRESET_PREFIX);
    const interaction = createButtonInteraction({
      customId: 'settings-preset-override::cancel',
    });

    await handleOverrideBatchButton(config, interaction);

    expect(config.logger.debug).toHaveBeenCalledWith(
      { customId: 'settings-preset-override::cancel' },
      'Ignoring non-batch customId'
    );
    expect(interaction.deferUpdate).not.toHaveBeenCalled();
    expect(stub.delete).not.toHaveBeenCalled();
  });

  it('isOverrideBatchButton matches only batch-select, batch-confirm, and batch-cancel', () => {
    const ids = createOverrideBrowseCustomIds(PRESET_PREFIX);
    expect(isOverrideBatchButton(ids, ids.batchSelect)).toBe(true);
    expect(isOverrideBatchButton(ids, ids.batchConfirm)).toBe(true);
    expect(isOverrideBatchButton(ids, ids.batchCancel)).toBe(true);
    expect(isOverrideBatchButton(ids, ids.select)).toBe(false);
    expect(isOverrideBatchButton(ids, ids.cancel)).toBe(false);
    expect(isOverrideBatchButton(ids, ids.clear('p1', 'text'))).toBe(false);
  });
});

describe('survival ladder & customId length budget', () => {
  it('delivers result-only embed when refreshed list returns null, and falls back to followUp when editReply rejects', async () => {
    const config = makeConfig(TTS_PREFIX);
    stub.delete.mockResolvedValue(makeOk({ deleted: true }));
    stub.list.mockResolvedValue(null);

    const interaction1 = createButtonInteraction({
      customId: 'voice-tts-override::batch-confirm',
      footerText: encodeBatchFooterIds(['p1']),
    });
    await handleOverrideBatchConfirm(config, interaction1);
    expect(lastEmbedsJson(interaction1)).toHaveLength(1);

    // When both post-mutation editReply attempts reject, followUp carries the counts line.
    stub.list.mockResolvedValue([makeOverride('p2', 'Bob', 'Aria')]);
    const interaction2 = createButtonInteraction({
      customId: 'voice-tts-override::batch-confirm',
      footerText: encodeBatchFooterIds(['p1']),
    });
    vi.mocked(interaction2.editReply)
      .mockResolvedValueOnce(undefined as never)
      .mockRejectedValueOnce(new Error('Invalid Form Body'))
      .mockRejectedValueOnce(new Error('Unknown Message'));

    await handleOverrideBatchConfirm(config, interaction2);

    expect(interaction2.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining('1 succeeded, 0 already gone, 0 failed'),
        flags: MessageFlags.Ephemeral,
      })
    );
  });

  it('buildRefreshedOverrideView returns null when config.list returns null', async () => {
    stub.list.mockResolvedValue(null);
    const view = await buildRefreshedOverrideView(
      makeConfig(PRESET_PREFIX),
      {} as unknown as UserClient
    );
    expect(view).toBeNull();
  });

  it('fallbackOverrideLabel includes the slot when present and omits it when absent or unknown', () => {
    expect(fallbackOverrideLabel('3f9c2e7a-8b4d-4c1a-9d6e-000000000001')).toBe(
      'Override ID: 3f9c2e7a…'
    );
    expect(fallbackOverrideLabel('3f9c2e7a-8b4d-4c1a-9d6e-000000000001::vision')).toBe(
      'Override ID: 3f9c2e7a… (vision)'
    );
    expect(fallbackOverrideLabel('3f9c2e7a-8b4d-4c1a-9d6e-000000000001::bogus')).toBe(
      'Override ID: 3f9c2e7a…'
    );
    expect(fallbackOverrideLabel('3f9c2e7a-8b4d-4c1a-9d6e-000000000001::')).toBe(
      'Override ID: 3f9c2e7a…'
    );
  });

  it('keeps all preset and TTS batch customIds well under the 100-char Discord limit', () => {
    for (const prefix of [PRESET_PREFIX, TTS_PREFIX]) {
      const ids = createOverrideBrowseCustomIds(prefix);
      for (const id of [ids.batchSelect, ids.batchConfirm, ids.batchCancel]) {
        expect(id.length).toBeLessThanOrEqual(DISCORD_LIMITS.CUSTOM_ID_MAX_LENGTH);
      }
    }
  });
});
