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
 * - a per-item result line renderer for the result embed.
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  type StringSelectMenuBuilder,
} from 'discord.js';
import { buildConfirmAction } from '../confirmation/confirmAction.js';
import { clampEmbedText } from '../embedLimits.js';
import type { BrowseActionRow } from './types.js';

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

/** Result embed for a finished batch run (per-item lines already rendered). */
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
