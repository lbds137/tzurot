/**
 * Shared Override Browser Batch Flow ("Select several")
 *
 * Multi-select batch clear for `/preset override browse` and `/voice tts browse`
 * via {@link OverrideBrowseConfig}:
 * - `batch-select` button swaps the browse view into multi-select mode (min 1,
 *   max = min(25, count), Cancel button, no pagination row).
 * - `batch-select` menu submission renders a single-verb `Clear (N)` confirmation
 *   listing every selected override, with the raw option values (`personalityId`
 *   or `personalityId::slot`) encoded directly in the confirm embed's footer.
 * - `batch-confirm` strips components, runs `config.delete(userClient, personalityId, slot)`
 *   sequentially with per-item failure isolation (no pre-loop list re-fetch —
 *   the option value is already the complete removal key), and delivers the
 *   result embed stacked over a refreshed browse view via `deliverBatchReport`.
 * - `batch-cancel` returns to a freshly-fetched single-select browse view.
 */

import {
  escapeMarkdown,
  MessageFlags,
  type ButtonInteraction,
  type Message,
  type StringSelectMenuInteraction,
} from 'discord.js';
import type { UserClient } from '@tzurot/clients';
import type { DeleteModelOverrideResponse } from '@tzurot/common-types/schemas/api/model-override';
import { clientsFor } from './gatewayClients.js';
import { pluralize } from './browse/index.js';
import {
  batchResultColor,
  buildBatchConfirmView,
  buildBatchResultEmbed,
  clampBatchConfirmDescription,
  deliverBatchReport,
  encodeBatchFooterIds,
  formatBatchCountsLine,
  formatBatchItemLines,
  formatFallbackIdLabel,
  parseBatchFooterIds,
  readSelectOptionLabels,
  runBatchSequentially,
  toBatchOutcomeLine,
  type BatchItemResult,
  type BatchReportView,
  type BatchResultLine,
} from './browse/multiSelectBatch.js';
import { truncateForSelect } from './browse/truncation.js';
import { ackUpdate } from '../ux/render/reply.js';
import {
  type OverrideBrowseConfig,
  type OverrideBrowseCustomIds,
  FAILED_TO_LOAD_MSG,
  GENERIC_ERROR_MSG,
  buildOverrideBrowseView,
  createOverrideBrowseCustomIds,
  errorReply,
  parseOverrideSelectValue,
} from './overrideBrowse.js';

/**
 * Per-item failure note mirroring `overrideBrowse.ts`'s one-pick clear failure
 * copy (`❌ Failed to clear the override. Please try again later.`), without
 * the leading glyph because `formatBatchItemLines` prepends `❌`.
 */
export const FAILED_TO_CLEAR_NOTE = 'Failed to clear the override. Please try again later.';

/** Shown when a batch confirm arrives with no recoverable selection in its footer. */
const MISSING_SELECTION_MSG =
  '❌ Could not determine which overrides were selected. Please try again.';

/** Shown when a multi-select submission carries no option values. */
const EMPTY_SELECTION_MSG = '❌ No overrides were selected.';

/** Bullet prefix of each listing line in the confirm embed, written at pick and parsed back at confirm. */
const LISTING_BULLET = '• ';

/** Outcome of one single-override delete call inside the batch loop. */
type OverrideBatchOutcome = 'success' | 'already-gone';

/**
 * Fallback display label when an override's option label is not available on
 * the interaction message (e.g., standalone confirm invocations in tests).
 * Includes the slot suffix when present so two slots of the same personality
 * remain distinct.
 */
export function fallbackOverrideLabel(rawValue: string): string {
  const { personalityId, slot } = parseOverrideSelectValue(rawValue);
  const base = formatFallbackIdLabel(personalityId, 'Override');
  return slot === undefined ? base : `${base} (${slot})`;
}

/** Whether a customId targets one of the batch button actions (`batch-select` / `batch-confirm` / `batch-cancel`). */
export function isOverrideBatchButton(ids: OverrideBrowseCustomIds, customId: string): boolean {
  const parsed = ids.parse(customId);
  return (
    parsed !== null &&
    (parsed.action === 'batch-select' ||
      parsed.action === 'batch-confirm' ||
      parsed.action === 'batch-cancel')
  );
}

/**
 * Append the slot suffix (` (text)` / ` (vision)`) to a label recovered from a
 * select option, so two slots of the same character stay distinguishable.
 * Slot-less ids (TTS) pass through unchanged. Not applied to
 * {@link fallbackOverrideLabel}, which already carries the suffix.
 */
function withSlotSuffix(label: string, rawValue: string): string {
  const { slot } = parseOverrideSelectValue(rawValue);
  return slot === undefined ? label : `${label} (${slot})`;
}

/**
 * Recover per-id display labels from the confirm embed description's bullet
 * lines (already escaped, slot suffix included, by `handleOverrideBatchPick`)
 * when they match `ids.length`. The confirm message carries only buttons, so no
 * select-menu options exist to read here. The all-or-nothing count match falls
 * back to id labels if the listing was clamped. 25 plain labels fit the ~3.8k
 * budget, but escaping can double a markdown-heavy label, so long ones can clamp.
 */
function resolveConfirmDisplayLabels(
  message: Message,
  ids: readonly string[]
): Map<string, string> {
  const resolved = new Map<string, string>();
  const description = message.embeds[0]?.description;
  if (typeof description === 'string' && description.length > 0) {
    const [listingBlock] = description.split('\n\n');
    const bulletLines = (listingBlock ?? '').split('\n');
    if (
      bulletLines.length === ids.length &&
      bulletLines.every(line => line.startsWith(LISTING_BULLET))
    ) {
      ids.forEach((id, index) => {
        const line = bulletLines[index];
        if (line !== undefined) {
          resolved.set(id, line.slice(LISTING_BULLET.length));
        }
      });
    }
  }
  return resolved;
}

/** `wasSet` as both DELETE routes' response schemas declare it. */
type DeleteOverrideWasSet = Pick<DeleteModelOverrideResponse, 'wasSet'>;

function isWasSetFalse(data: unknown): boolean {
  return (
    typeof data === 'object' && data !== null && (data as DeleteOverrideWasSet).wasSet === false
  );
}

/**
 * Execute one override clear against the gateway envelope contract:
 * - `result.ok` (with `wasSet !== false`) → `'success'`
 * - `result.ok` with `wasSet === false` → `'already-gone'` (both DELETE routes
 *   answer an absent override with this idempotent 200 — see the
 *   model-override.ts and tts-override.ts handlers in api-gateway)
 * - any `!result.ok`, a 404 included, throws `FAILED_TO_CLEAR_NOTE` so `runBatchSequentially`
 *   records `{ ok: false, error }` for that item and continues the loop.
 * - a thrown `config.delete` is logged (ids only) and rethrown as the same
 *   `FAILED_TO_CLEAR_NOTE`, so a raw transport message never reaches the result line.
 * Each failure's cause is logged with ids only; the result line carries only the note.
 */
async function runSingleOverrideClear(
  config: OverrideBrowseConfig,
  userClient: UserClient,
  rawValue: string,
  userId: string
): Promise<OverrideBatchOutcome> {
  const { personalityId, slot } = parseOverrideSelectValue(rawValue);
  let result: Awaited<ReturnType<OverrideBrowseConfig['delete']>>;
  try {
    result = await config.delete(userClient, personalityId, slot);
  } catch (error) {
    config.logger.warn(
      { err: error, userId, personalityId, slot },
      'Batch override clear item threw'
    );
    throw new Error(FAILED_TO_CLEAR_NOTE, { cause: error });
  }
  if (result.ok) {
    return isWasSetFalse(result.data) ? 'already-gone' : 'success';
  }
  config.logger.warn(
    { userId, personalityId, slot, status: result.status },
    'Batch override clear item failed'
  );
  throw new Error(FAILED_TO_CLEAR_NOTE);
}

function buildOverrideBatchResultLines(
  ids: readonly string[],
  labels: ReadonlyMap<string, string>,
  results: readonly BatchItemResult<OverrideBatchOutcome>[]
): BatchResultLine[] {
  const formatLabel = (id: string): string => {
    // A recovered label is used as-is: `handleOverrideBatchPick` already escaped
    // and suffixed it, so a second cut or escape would clip the suffix or double-escape.
    const known = labels.get(id);
    if (known !== undefined) {
      return known;
    }
    return escapeMarkdown(truncateForSelect(fallbackOverrideLabel(id), { stripNewlines: true }));
  };

  const resultMap = new Map<string, BatchResultLine>(
    results.map(result => [
      result.id,
      toBatchOutcomeLine(result, formatLabel(result.id), FAILED_TO_CLEAR_NOTE),
    ])
  );

  return ids.map(
    id =>
      resultMap.get(id) ?? {
        label: formatLabel(id),
        status: 'failed',
        note: FAILED_TO_CLEAR_NOTE,
      }
  );
}

/** Build the refreshed browse view for the batch report stack; returns null on list failure. */
export async function buildRefreshedOverrideView(
  config: OverrideBrowseConfig,
  userClient: UserClient
): Promise<BatchReportView | null> {
  const overrides = await config.list(userClient);
  if (overrides === null) {
    return null;
  }
  const view = buildOverrideBrowseView(config, overrides);
  return { embed: view.embeds[0], components: view.components };
}

/**
 * "Select several" entry button handler — re-fetches overrides and swaps the
 * browse view into multi-select mode (select + Cancel, no pagination row).
 */
export async function handleOverrideBatchSelectEntry(
  config: OverrideBrowseConfig,
  interaction: ButtonInteraction
): Promise<void> {
  await refreshOverrideBrowseView(
    config,
    interaction,
    'batch',
    'Failed to list overrides for batch select',
    'Error in override batch select entry'
  );
}

/**
 * Ack, re-fetch the overrides and swap the message to a freshly-built browse
 * view. `'batch'` renders multi-select mode, but an empty list has nothing to
 * select, so it renders the plain single-select view instead. A null list or a
 * thrown error answers with the matching error reply and the given log line.
 */
async function refreshOverrideBrowseView(
  config: OverrideBrowseConfig,
  interaction: ButtonInteraction,
  mode: 'single' | 'batch',
  failureLogMessage: string,
  errorLogMessage: string
): Promise<void> {
  await ackUpdate(interaction);
  const userId = interaction.user.id;
  try {
    const { userClient } = clientsFor(interaction);
    const overrides = await config.list(userClient);
    if (overrides === null) {
      config.logger.warn({ userId }, failureLogMessage);
      await interaction.editReply(errorReply(FAILED_TO_LOAD_MSG));
      return;
    }
    const view =
      mode === 'batch' && overrides.length > 0
        ? buildOverrideBrowseView(config, overrides, { mode: 'batch' })
        : buildOverrideBrowseView(config, overrides);
    await interaction.editReply({ content: '', ...view });
  } catch (error) {
    config.logger.error({ err: error, userId }, errorLogMessage);
    await interaction.editReply(errorReply(GENERIC_ERROR_MSG));
  }
}

/**
 * Multi-select submission handler — builds the single-verb `Clear (N)` batch
 * confirmation view listing every selected override and storing the raw option
 * values in the confirm embed's footer.
 */
export async function handleOverrideBatchPick(
  config: OverrideBrowseConfig,
  interaction: StringSelectMenuInteraction
): Promise<void> {
  await ackUpdate(interaction);

  const ids = interaction.values.filter(value => value.length > 0);
  if (ids.length === 0) {
    await interaction.editReply(errorReply(EMPTY_SELECTION_MSG));
    return;
  }

  const labels = readSelectOptionLabels(interaction.message);
  const listing = ids
    .map(id => {
      const known = labels.get(id);
      return `${LISTING_BULLET}${known !== undefined ? withSlotSuffix(escapeMarkdown(known), id) : escapeMarkdown(fallbackOverrideLabel(id))}`;
    })
    .join('\n');
  const countNoun = pluralize(ids.length, {
    singular: config.entityType,
    plural: `${config.entityType}s`,
  });
  const warning =
    `**This clears ${countNoun} immediately.** ` +
    `Cleared characters will fall back to your default ${config.fallbackNoun}. You can re-set them any time.`;

  const customIds = createOverrideBrowseCustomIds(config.prefix);
  const { embed, components } = buildBatchConfirmView({
    title: `${config.entityEmoji} Clear ${config.titleNoun}?`,
    description: clampBatchConfirmDescription(listing, warning),
    // Option values are newline-free by construction (UUID/snowflake + `text|vision`
    // slot enum), so the shared newline-delimited codec needs no percent-escaping.
    // Footer budget: at most 25 ids x ~44 chars < 1200 chars, well under Discord's
    // 2048-char footer limit, so no runtime guard is needed.
    footerText: encodeBatchFooterIds(ids),
    confirm: {
      customId: customIds.batchConfirm,
      label: `Clear (${ids.length})`,
      emoji: '🗑️',
    },
    cancelCustomId: customIds.batchCancel,
  });

  await interaction.editReply({ content: '', embeds: [embed], components });
}

/**
 * Batch cancel button handler (from multi-select mode or the batch confirm
 * view) — returns to a freshly-fetched single-select browse view without
 * deleting anything.
 */
export async function handleOverrideBatchCancel(
  config: OverrideBrowseConfig,
  interaction: ButtonInteraction
): Promise<void> {
  await refreshOverrideBrowseView(
    config,
    interaction,
    'single',
    'Failed to refresh overrides on batch cancel',
    'Error in override batch cancel handler'
  );
}

/**
 * Batch confirm button handler — strips confirm components, executes per-item
 * `config.delete(userClient, personalityId, slot)` calls sequentially with
 * failure isolation, and delivers the outcome report stacked over the refreshed
 * browse view via `deliverBatchReport`.
 */
export async function handleOverrideBatchConfirm(
  config: OverrideBrowseConfig,
  interaction: ButtonInteraction
): Promise<void> {
  if (!interaction.deferred && !interaction.replied) {
    await ackUpdate(interaction);
  }

  const userId = interaction.user.id;
  const rawFooter = interaction.message.embeds[0]?.footer?.text;
  const ids = parseBatchFooterIds(rawFooter);
  if (ids === null) {
    config.logger.warn({ userId }, 'Missing or empty batch footer ids on override confirm');
    await interaction.editReply(errorReply(MISSING_SELECTION_MSG));
    return;
  }

  let labels: Map<string, string>;
  let userClient: UserClient;
  try {
    labels = resolveConfirmDisplayLabels(interaction.message, ids);
    ({ userClient } = clientsFor(interaction));
    await interaction.editReply({ components: [] });
  } catch (error) {
    // Nothing has been cleared yet on this path. The strip may be what failed, so
    // the editReply channel is suspect: answer on an ephemeral followUp instead.
    config.logger.error({ err: error, userId }, 'Error preparing override batch confirm');
    await interaction
      .followUp({ content: GENERIC_ERROR_MSG, flags: MessageFlags.Ephemeral })
      .catch((followUpError: unknown) => {
        config.logger.warn(
          { err: followUpError, userId },
          'Override batch confirm error followUp failed'
        );
      });
    return;
  }

  const results = await runBatchSequentially(ids, id =>
    runSingleOverrideClear(config, userClient, id, userId)
  );

  const lines = buildOverrideBatchResultLines(ids, labels, results);
  const succeeded = lines.filter(line => line.status === 'success').length;
  const gone = lines.filter(line => line.status === 'gone').length;
  const failed = lines.filter(line => line.status === 'failed').length;

  config.logger.info(
    { userId, requested: ids.length, succeeded, gone, failed },
    'Batch override clear finished'
  );

  const resultEmbed = buildBatchResultEmbed({
    title: `🗑️ Clear ${config.titleNoun} Results`,
    color: batchResultColor({ succeeded, failed }),
    lines: formatBatchItemLines(lines),
  });

  const countsLine = formatBatchCountsLine({ succeeded, gone, failed });
  const viewPromise = buildRefreshedOverrideView(config, userClient).catch(
    (error: unknown): null => {
      config.logger.warn(
        { err: error, userId },
        'Refreshed override view failed; reporting the batch result alone'
      );
      return null;
    }
  );

  await deliverBatchReport(interaction, {
    resultEmbed,
    viewPromise,
    countsLine,
    verb: 'clear',
  });
}

/** Dispatch a batch button interaction (`batch-select` / `batch-confirm` / `batch-cancel`). */
export async function handleOverrideBatchButton(
  config: OverrideBrowseConfig,
  interaction: ButtonInteraction
): Promise<void> {
  const ids = createOverrideBrowseCustomIds(config.prefix);
  const parsed = ids.parse(interaction.customId);
  if (parsed?.action === 'batch-select') {
    await handleOverrideBatchSelectEntry(config, interaction);
    return;
  }
  if (parsed?.action === 'batch-confirm') {
    await handleOverrideBatchConfirm(config, interaction);
    return;
  }
  if (parsed?.action === 'batch-cancel') {
    await handleOverrideBatchCancel(config, interaction);
    return;
  }
  config.logger.debug({ customId: interaction.customId }, 'Ignoring non-batch customId');
}
