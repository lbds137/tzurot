/**
 * Entity detail-card scaffold (design-system G5).
 *
 * One data-driven builder for the single-entity detail embeds (memory, fact,
 * denylist entry, voice settings, persona, shape). Everything is plain data —
 * no callbacks: callers derive state-dependent title prefixes, colors, and
 * footer strings themselves and pass the results in. The value of the seam is
 * uniformity (empty-field skipping, spacer grids, safe description
 * truncation) and a single place where list-grammar decisions land; a
 * non-Discord renderer would swap in behind this signature.
 *
 * Deliberately NOT served by this builder: `character/view`'s multi-page
 * PAGE_BUILDERS system — fitting it would need page-selection, per-field
 * truncation tracking, and expand-row config (well past the 2-callback
 * extraction ceiling), so it stays hand-rolled.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import { truncateByCodePoints } from './modal/toolkit.js';

/** One embed field; `inline` defaults to false. */
export interface DetailCardField {
  name: string;
  value: string;
  inline?: boolean;
}

/**
 * Field-slot union: `'spacer'` renders an invisible inline cell (zero-width
 * space) to force 2-per-row grid alignment in Discord's 3-column field
 * layout; `null`/`undefined`/`false` slots are skipped, so callers can write
 * conditional fields as `cond && { ... }`.
 */
export type DetailCardFieldSlot = DetailCardField | 'spacer' | null | undefined | false;

/**
 * Description truncation travels as a pair: a cap without a notice would
 * silently swallow content with no user-visible indicator, so the type
 * forces both or neither. The notice must be shorter than the cap — the
 * cut floors at zero, so an over-long notice would itself exceed the cap.
 */
type DescriptionTruncation =
  | {
      /**
       * Cap on the description's length in code points. Over-cap content is
       * cut (surrogate-safe) to leave room for `truncationNotice`, which is
       * appended, and the returned `descriptionTruncated` flag flips —
       * callers use it to render a "view full" affordance.
       */
      descriptionCap: number;
      /** Appended when the cap trips. */
      truncationNotice: string;
    }
  | { descriptionCap?: undefined; truncationNotice?: undefined };

export type EntityDetailCardOptions = {
  /** Full title including any state-derived prefix (e.g. a 🔒 lock marker). */
  title: string;
  /** Defaults to BLURPLE; pass a state-derived color to override. */
  color?: number;
  description?: string;
  fields?: DetailCardFieldSlot[];
  /** Footer text verbatim — callers own the shape (ID, dates, hint, state). */
  footer?: string;
  /** Stamp the embed timestamp (off by default). */
  timestamp?: boolean;
} & DescriptionTruncation;

export interface EntityDetailCard {
  embed: EmbedBuilder;
  descriptionTruncated: boolean;
}

/** Invisible inline cell backing the `'spacer'` slot. */
const SPACER_FIELD = { name: '\u200B', value: '\u200B', inline: true } as const;

function resolveDescription(options: EntityDetailCardOptions): {
  description: string | undefined;
  truncated: boolean;
} {
  const { description, descriptionCap, truncationNotice } = options;
  if (description === undefined || description.length === 0) {
    return { description: undefined, truncated: false };
  }
  if (descriptionCap === undefined || [...description].length <= descriptionCap) {
    return { description, truncated: false };
  }
  const notice = truncationNotice ?? '';
  const cut = truncateByCodePoints(description, Math.max(0, descriptionCap - [...notice].length));
  return { description: cut + notice, truncated: true };
}

/** Build a single-entity detail embed from plain data. */
export function buildEntityDetailCard(options: EntityDetailCardOptions): EntityDetailCard {
  const embed = new EmbedBuilder()
    .setTitle(options.title)
    .setColor(options.color ?? DISCORD_COLORS.BLURPLE);

  const { description, truncated } = resolveDescription(options);
  if (description !== undefined) {
    embed.setDescription(description);
  }

  const fields = (options.fields ?? [])
    .filter(
      (slot): slot is DetailCardField | 'spacer' =>
        slot !== null && slot !== undefined && slot !== false
    )
    .map(slot =>
      slot === 'spacer'
        ? SPACER_FIELD
        : { name: slot.name, value: slot.value, inline: slot.inline ?? false }
    );
  if (fields.length > 0) {
    embed.addFields(fields);
  }

  if (options.footer !== undefined && options.footer.length > 0) {
    embed.setFooter({ text: options.footer });
  }
  if (options.timestamp === true) {
    embed.setTimestamp();
  }

  return { embed, descriptionTruncated: truncated };
}
