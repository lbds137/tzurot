/**
 * Multi-select batch helpers for browse lists.
 *
 * The pieces a "Select several" batch surface needs, shared so sibling browse
 * commands can adopt the same flow without copying it:
 *
 * - the entry toggle button,
 * - footer-state encode/parse for the selected id list (newline-joined ids
 *   ride the confirm embed's footer; the verb rides the customId),
 * - a sequential batch executor with per-item failure isolation — one
 *   failing item never stops the run,
 * - a per-item result line renderer for the result embed,
 * - the batch outcome-report delivery ladder (result embed stacked over the
 *   refreshed list view, degrading so the report always reaches the user),
 * - the shared page-fetch-failed copy.
 *
 * Second-tap window: a verb tap Discord delivers inside the confirm handler's
 * ack + component-strip window still starts a second flow whose report
 * replaces the first's ("already gone" over the real outcome). The handlers
 * shrink that window by stripping the confirm components before the pre-loop
 * fetch (pinned in each flow's tests); a tap inside the remaining window is
 * a known, named consequence — not a session-flag-guarded one.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type ButtonInteraction,
  type Message,
  type StringSelectMenuBuilder,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { buildConfirmAction } from '../confirmation/confirmAction.js';
import { clampEmbedText } from '../embedLimits.js';
import { truncateToUtf16Units } from '@tzurot/common-types/utils/codePointTruncation';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { followUpSpec } from '../../ux/render/reply.js';
import type { BrowseActionRow } from './types.js';

const logger = createLogger('browse-multi-select-batch');

/**
 * Shared copy for a LIVE session whose page fetch failed — not an expired
 * session, so it must not read as one. One const so every batch flow's entry
 * and refusal paths quote identical copy.
 */
export const PAGE_FETCH_FAILED_COPY = "Couldn't load that page right now.";

/**
 * The "Select several" entry button. Secondary: it opens a mode, it does not
 * itself act. Callers pass their own `customId` — the token vocabulary stays
 * with each command's action family.
 */
export function buildSelectSeveralToggle(
  customId: string,
  label = 'Select several'
): ButtonBuilder {
  return new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setEmoji('☑️')
    .setStyle(ButtonStyle.Secondary);
}

/** The toggle button as a complete action row, ready for the components array. */
export function buildSelectSeveralToggleRow(
  customId: string,
  label = 'Select several'
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    buildSelectSeveralToggle(customId, label)
  );
}

/**
 * Map option value → label for every select menu on a message. discord.js
 * rehydrates message components as builders, so each row is normalized via
 * toJSON() and walked generically as unknown data. Command-agnostic: the
 * walker knows nothing about the items behind the options.
 */
export function readSelectOptionLabels(message: Message): Map<string, string> {
  const labels = new Map<string, string>();
  for (const row of message.components) {
    collectSelectOptionLabels(row.toJSON(), labels);
  }
  return labels;
}

function collectSelectOptionLabels(source: unknown, labels: Map<string, string>): void {
  if (typeof source !== 'object' || source === null) {
    return;
  }
  const record = source as Record<string, unknown>;
  const options = record.options;
  if (Array.isArray(options)) {
    collectOptionEntries(options, labels);
  }
  const children = record.components;
  if (Array.isArray(children)) {
    for (const child of children) {
      collectSelectOptionLabels(child, labels);
    }
  }
}

function collectOptionEntries(options: unknown[], labels: Map<string, string>): void {
  for (const option of options) {
    if (typeof option !== 'object' || option === null) {
      continue;
    }
    const entry = option as Record<string, unknown>;
    const value = entry.value;
    const label = entry.label;
    if (typeof value === 'string') {
      labels.set(value, typeof label === 'string' ? label : value);
    }
  }
}

/**
 * Fallback display label when an item's real label can't be resolved — a
 * short id prefix under the item-type noun (e.g. `Memory ID: 3f9c2e7a…`).
 */
export function formatFallbackIdLabel(id: string, noun: string): string {
  return `${noun} ID: ${id.slice(0, 8)}…`;
}

/**
 * Assemble a confirm description that clamps the LISTING, never the warning:
 * end-truncating the whole description would silently drop the safety copy —
 * the one text that must survive a long pick list. The listing is cut to fit
 * the budget beside the warning; the warning itself is always appended whole.
 */
export function clampBatchConfirmDescription(
  listing: string,
  warning: string,
  budget = 3800
): string {
  const joiner = '\n\n';
  const usable = Math.max(budget - warning.length - joiner.length, 0);
  const clampedListing =
    listing.length > usable ? truncateToUtf16Units(listing, usable, '…') : listing;
  return `${clampedListing}${joiner}${warning}`;
}

/** A single Secondary Cancel button on its own row. */
export function buildCancelButtonRow(
  customId: string,
  label = 'Cancel'
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(customId).setLabel(label).setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Assemble a multi-select mode view: the (already built) select row when
 * present, then a Cancel affordance — no pagination row. Batch mode serves
 * exactly one page (the batch operations act on the current page only, per
 * doc-113's shape), and the normal pagination customIds route to the
 * single-select render, so a pagination row here would silently exit batch
 * mode. Cancel → paginate → Select several is the honest path.
 */
export function buildBatchModeRows(options: {
  selectRow: ActionRowBuilder<StringSelectMenuBuilder> | null;
  cancelCustomId: string;
}): BrowseActionRow[] {
  const rows: BrowseActionRow[] = [];
  if (options.selectRow !== null) {
    rows.push(options.selectRow);
  }
  rows.push(buildCancelButtonRow(options.cancelCustomId));
  return rows;
}

/** A verb button (label + emoji set separately, per the button style rule). */
function buildVerbButton(
  verb: { customId: string; label: string; emoji?: string },
  style: ButtonStyle
): ButtonBuilder {
  const button = new ButtonBuilder()
    .setCustomId(verb.customId)
    .setLabel(verb.label)
    .setStyle(style);
  if (verb.emoji !== undefined) {
    button.setEmoji(verb.emoji);
  }
  return button;
}

export interface BatchConfirmViewOptions {
  /** Embed title (include the action emoji if the surface wants one). */
  title: string;
  /** Fully-assembled embed description (the per-item listing + warnings). */
  description: string;
  /** Footer text carrying the batch state (e.g. the selected id list). */
  footerText: string;
  /**
   * Secondary verb, on its own row ABOVE the confirm row. Omit for a
   * single-verb confirm — the Danger verb rides the factory row alone.
   */
  secondaryVerb?: { customId: string; label: string; emoji?: string };
  /** Danger confirm — last button of the last row (factory-ordered row). */
  confirm: { customId: string; label: string; emoji?: string };
  cancelCustomId: string;
}

export interface BatchConfirmView {
  embed: EmbedBuilder;
  components: BrowseActionRow[];
}

/**
 * Batch confirmation view: every selected item listed, an optional Secondary
 * verb row above the Tier-A factory row (Cancel → Danger confirm). The
 * factory owns the confirm-pair invariants; an extra verb cannot share that
 * row without breaking Danger-last, so it rides above it. Single-verb
 * confirms pass no `secondaryVerb` and get the factory row alone.
 */
export function buildBatchConfirmView(options: BatchConfirmViewOptions): BatchConfirmView {
  const { embed, components: factoryRows } = buildConfirmAction({
    title: options.title,
    description: options.description,
    confirmCustomId: options.confirm.customId,
    confirmLabel: options.confirm.label,
    confirmEmoji: options.confirm.emoji,
    cancelCustomId: options.cancelCustomId,
  });
  embed.setFooter({ text: options.footerText });
  const components =
    options.secondaryVerb === undefined
      ? factoryRows
      : [
          new ActionRowBuilder<ButtonBuilder>().addComponents(
            buildVerbButton(options.secondaryVerb, ButtonStyle.Secondary)
          ),
          ...factoryRows,
        ];
  return { embed, components };
}

/**
 * Result embed for a finished batch run (per-item lines already rendered).
 *
 * Budget note for stacking callers: Discord caps the SUM of embed text per
 * message at 6000 characters, and a full listing plus the refreshed list
 * embed can exceed it at 25-item pages — the stacked reply then falls back
 * to the result embed alone (its own description is clamped at 3800 here).
 * Callers must budget for that fallback, not assume the stack always sends.
 */
export function buildBatchResultEmbed(options: {
  title: string;
  color: number;
  lines: readonly string[];
}): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(options.title)
    .setColor(options.color)
    .setDescription(clampEmbedText(options.lines.join('\n'), 3800));
}

/**
 * Encode the selected id list for the confirm embed's footer: one id per
 * line. 25 ids of realistic length land far under Discord's 2049-character
 * footer cap (pinned in multiSelectBatch.test.ts).
 */
export function encodeBatchFooterIds(ids: readonly string[]): string {
  return ids.join('\n');
}

/**
 * Parse the id list back out of a footer text. Returns null when the footer
 * is absent or carries no ids — the caller treats that as an expired or
 * tampered confirm view.
 */
export function parseBatchFooterIds(text: string | undefined): string[] | null {
  if (text === undefined || text.length === 0) {
    return null;
  }
  const ids = text.split('\n').filter(part => part.length > 0);
  return ids.length > 0 ? ids : null;
}

/** One item's batch outcome: its value, or the error the op threw. */
export type BatchItemResult<T> =
  { id: string; ok: true; value: T } | { id: string; ok: false; error: unknown };

/**
 * Run `op` sequentially over every id, isolating failures: an op that throws
 * records `{ ok: false, error }` for its id and the run continues with the
 * rest. Order of the results follows the order of `ids`.
 */
export async function runBatchSequentially<T>(
  ids: readonly string[],
  op: (id: string) => Promise<T>
): Promise<BatchItemResult<T>[]> {
  const results: BatchItemResult<T>[] = [];
  for (const id of ids) {
    try {
      results.push({ id, ok: true, value: await op(id) });
    } catch (error) {
      results.push({ id, ok: false, error });
    }
  }
  return results;
}

/** Per-item outcome status for the result renderer. */
export type BatchItemStatus = 'success' | 'gone' | 'locked' | 'failed';

/** One line of the result listing, already resolved to a display label. */
export interface BatchResultLine {
  label: string;
  status: BatchItemStatus;
  /** Human-readable detail (e.g. the classified failure reason). */
  note?: string;
}

const STATUS_GLYPHS: Record<BatchItemStatus, string> = {
  success: '✅',
  gone: '◻️',
  locked: '🔐',
  failed: '❌',
};

/** Render the per-item result lines (glyph + label, with the note when set). */
export function formatBatchItemLines(lines: readonly BatchResultLine[]): string[] {
  return lines.map(line => {
    const glyph = STATUS_GLYPHS[line.status];
    return line.note !== undefined
      ? `${glyph} ${line.label} — ${line.note}`
      : `${glyph} ${line.label}`;
  });
}

/** A refreshed list view for the batch report stack (embed + action rows). */
export interface BatchReportView {
  embed: EmbedBuilder;
  components: BrowseActionRow[];
}

export interface BatchReportOptions {
  /** The caller-built result embed (title/color stay per-flow). */
  resultEmbed: EmbedBuilder;
  /**
   * The caller's kind-refreshed view, ALREADY `.catch(warn → null)`-wrapped —
   * the flow knows its own kind and its refresh can degrade on its own terms.
   */
  viewPromise: Promise<BatchReportView | null>;
  /** The verb-dependent counts copy for the last-resort followUp. */
  countsLine: string;
  /** Log field only — identifies the verb in the ladder's warn lines. */
  verb: string;
}

/**
 * Deliver the batch outcome report on the survival ladder: the mutations have
 * already run, so the report must survive reply failures on EVERY branch —
 * the stacked reply falls back to the result embed alone, and either reply
 * shape falls back to a plain ephemeral followUp carrying just the counts
 * (6000-char sum budget; see buildBatchResultEmbed).
 */
export async function deliverBatchReport(
  interaction: ButtonInteraction,
  options: BatchReportOptions
): Promise<void> {
  const { resultEmbed, viewPromise, countsLine, verb } = options;

  // Last resort on either branch — the mutations already ran, so the counts
  // must reach the user even when the message itself can no longer be edited.
  const followUpCounts = (): Promise<void> =>
    followUpSpec(interaction, CATALOG.info.note(countsLine));

  // Result embed alone, still laddered: if even this editReply rejects
  // (message deleted mid-run), the counts followUp delivers the report.
  const deliverResultOnly = async (): Promise<void> => {
    try {
      await interaction.editReply({ embeds: [resultEmbed], components: [] });
    } catch (error) {
      logger.warn(
        { err: error, verb },
        'Result-only batch reply failed; falling back to counts followUp'
      );
      await followUpCounts();
    }
  };

  const view = await viewPromise;
  if (view === null) {
    await deliverResultOnly();
    return;
  }
  try {
    await interaction.editReply({
      embeds: [resultEmbed, view.embed],
      components: view.components,
    });
  } catch (error) {
    logger.warn({ err: error, verb }, 'Stacked batch result reply failed; retrying result-only');
    await deliverResultOnly();
  }
}
