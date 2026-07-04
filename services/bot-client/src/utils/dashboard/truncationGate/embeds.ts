/**
 * Truncation Gate — display helpers.
 *
 * Embed builders for the destructive-action warning + the post-opt-in
 * "Ready to edit" interstitial. Entity-agnostic; both character and
 * persona dashboards (and future ones) render identical copy.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';
import type { OverLengthField } from './detection.js';

/**
 * Strip a leading emoji + whitespace from a section label so modal titles,
 * embed titles, and attachment copy read cleanly. Mirrors the inline regex
 * in `ModalFactory.ts:51` (modal title derivation).
 */
export function stripLeadingEmoji(label: string): string {
  return label.replace(/^[^\w\s]+\s*/, '');
}

/**
 * Convert a user-facing field label into a safe filename slug. Lowercased,
 * whitespace collapsed to underscores, non-alphanumeric chars removed so
 * the resulting name works across OSes. The trailing collapse-runs pass
 * keeps labels like `"Bot's Tone & Style"` from producing double
 * underscores where punctuation sat between spaces.
 */
export function toSafeFilename(label: string): string {
  const slug = label
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_');
  // Pure-punctuation labels would slug to empty. Defense-in-depth — the
  // dashboard configs control labels today, but a future caller could
  // pass arbitrary input and we don't want to produce just `.txt`.
  return slug || 'field';
}

/**
 * Build the destructive-action warning embed listing the over-length
 * fields, their current lengths, and the per-field truncation amount.
 */
export function buildTruncationWarningEmbed(
  overLength: OverLengthField[],
  sectionLabel: string
): EmbedBuilder {
  const plainLabel = stripLeadingEmoji(sectionLabel);

  const fieldLines = overLength
    .map(f => {
      const loss = f.current - f.max;
      return (
        `• **${f.label}** — ${f.current.toLocaleString()} / ${f.max.toLocaleString()} chars ` +
        `(${loss.toLocaleString()} will be truncated)`
      );
    })
    .join('\n');

  const totalLoss = overLength.reduce((sum, f) => sum + (f.current - f.max), 0);

  return new EmbedBuilder()
    .setTitle(`⚠️ "${plainLabel}" contains content longer than Discord modals allow`)
    .setColor(DISCORD_COLORS.WARNING)
    .setDescription(
      `One or more fields in this section hold values that exceed the edit modal's limit:\n\n` +
        `${fieldLines}\n\n` +
        `⚠️ **Opening the edit modal will pre-fill the fields with truncated values.** ` +
        `If you save the modal, the trailing content will be lost permanently.\n\n` +
        `Choose **View Full** to inspect the current full content before deciding. ` +
        `Choose **Edit with Truncation** only if you're OK losing the trailing text.`
    )
    .setFooter({
      text: `${totalLoss.toLocaleString()} total characters would be truncated across ${overLength.length} field${overLength.length === 1 ? '' : 's'}`,
    });
}

/**
 * Build the embed shown between the Edit-with-Truncation opt-in and the
 * actual modal. It reassures the user that their consent was recorded
 * and directs them to the single click that opens the modal.
 */
export function buildReadyToEditEmbed(sectionLabel: string): EmbedBuilder {
  const plainLabel = stripLeadingEmoji(sectionLabel);
  return new EmbedBuilder()
    .setTitle(`✅ Ready to edit "${plainLabel}"`)
    .setColor(DISCORD_COLORS.SUCCESS)
    .setDescription(
      `Your opt-in to truncate over-length fields has been recorded. ` +
        `Click **Open Editor** below to open the edit modal. ` +
        `The modal will open with the current values truncated to the edit limit.`
    );
}
