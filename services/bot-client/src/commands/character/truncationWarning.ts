/**
 * Character Truncation Warning
 *
 * Detects over-length legacy field values in a character section before a
 * user opens the edit modal, and shows a destructive-action warning with
 * explicit opt-in. Ports the pattern from `memory/detailModals.ts`
 * (buildTruncationWarningEmbed / handleEditTruncatedButton) to the
 * character dashboard's many-field modals.
 *
 * The silent-truncate site in `utils/dashboard/ModalFactory.ts:108`
 * still runs after user consent — this module's job is gating the
 * modal on an informed decision, plus offering a View Full read path
 * so users can see the content they'd be about to truncate before
 * committing.
 */

import {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  AttachmentBuilder,
  MessageFlags,
} from 'discord.js';
import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS, getConfig, type EnvConfig } from '@tzurot/common-types';
import {
  buildDashboardCustomId,
  buildSectionModal,
  type SectionDefinition,
} from '../../utils/dashboard/index.js';
import type { CharacterData } from './config.js';
import { resolveCharacterSectionContext } from './sectionContext.js';

const logger = createLogger('character-truncation-warning');

/**
 * Strip a leading emoji + whitespace from a section label so modal titles
 * / embed titles / attachment copy read cleanly. Mirrors the inline regex
 * in `ModalFactory.ts:51` (modal title derivation) — kept in sync by
 * convention until a section-label shortener becomes a third consumer
 * that warrants a shared helper.
 */
function stripLeadingEmoji(label: string): string {
  return label.replace(/^[^\w\s]+\s*/, '');
}

/**
 * A field whose current value exceeds its modal maxLength.
 */
export interface OverLengthField {
  /** The field id (matches CharacterData key) */
  fieldId: string;
  /** The user-facing label */
  label: string;
  /** Current character count */
  current: number;
  /** Configured maxLength — what the edit modal will truncate down to */
  max: number;
}

/**
 * Scan a section's fields and report any whose current value exceeds
 * the modal's maxLength constraint.
 *
 * Fields with `field.maxLength === undefined` are treated as unconstrained —
 * the ModalFactory applies default caps only when showing the modal, but
 * for warning purposes we only flag explicit user-visible caps. If a
 * field intentionally uses the default cap without declaring it, the
 * silent-truncate path for that field remains unchanged by this module.
 */
export function detectOverLengthFields(
  section: SectionDefinition<CharacterData>,
  data: CharacterData
): OverLengthField[] {
  const over: OverLengthField[] = [];
  for (const field of section.fields) {
    if (field.maxLength === undefined) {
      continue;
    }
    const raw = (data as Record<string, unknown>)[field.id];
    if (typeof raw !== 'string') {
      continue;
    }
    if (raw.length > field.maxLength) {
      over.push({
        fieldId: field.id,
        label: field.label,
        current: raw.length,
        max: field.maxLength,
      });
    }
  }
  return over;
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
 * Build the three-button row for the warning:
 * - Edit with Truncation (danger, opt-in to destructive edit)
 * - View Full (primary, safe read-only inspection)
 * - Cancel (secondary, dismiss)
 */
export function buildTruncationButtons(
  entityId: string,
  sectionId: string
): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId('character', 'edit_truncated', entityId, sectionId))
      .setLabel('Edit with Truncation')
      .setEmoji('✂️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId('character', 'view_full', entityId, sectionId))
      .setLabel('View Full')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId('character', 'cancel_edit', entityId, sectionId))
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary)
  );
}

/**
 * Show the truncation warning as an ephemeral reply to the select-menu
 * interaction. Extracted so the dashboard handler stays compact.
 */
export async function showTruncationWarning(
  interaction: StringSelectMenuInteraction,
  section: SectionDefinition<CharacterData>,
  entityId: string,
  overLength: OverLengthField[]
): Promise<void> {
  await interaction.reply({
    embeds: [buildTruncationWarningEmbed(overLength, section.label)],
    components: [buildTruncationButtons(entityId, section.id)],
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * "Edit with Truncation" handler — user has acknowledged the warning
 * and wants to proceed. Fetch fresh data, resolve the section, and show
 * the modal. The actual truncation happens inside ModalFactory.
 *
 * No `deferReply`/`deferUpdate` before the async work here: Discord
 * requires `showModal` to be the first response to the interaction
 * (you can't defer then modal). In practice the session is almost always
 * cached from the preceding select-menu interaction, so the async work
 * is a cheap Redis hit that fits inside the 3-second window. If a cache
 * miss is observed in production the right fix is a different UX shape
 * (e.g. instruct the user to retry), not deferring here.
 */
export async function handleEditTruncatedButton(
  interaction: ButtonInteraction,
  entityId: string,
  sectionId: string,
  config: EnvConfig = getConfig()
): Promise<void> {
  const ctx = await resolveCharacterSectionContext(interaction, entityId, sectionId, config);
  if (ctx === null) {
    return;
  }

  const modal = buildSectionModal(
    ctx.dashboardConfig,
    ctx.section,
    entityId,
    ctx.data,
    ctx.context
  );
  await interaction.showModal(modal);
}

/**
 * "View Full" handler — render the over-length field values as attached
 * `.txt` files so the user can inspect their content without triggering
 * the destructive edit path. Attachments handle arbitrary sizes uniformly
 * (no Discord embed-limit gymnastics) and let users save/search the
 * content locally.
 */
export async function handleViewFullButton(
  interaction: ButtonInteraction,
  entityId: string,
  sectionId: string,
  config: EnvConfig = getConfig()
): Promise<void> {
  // Ack within 3 seconds before any async work — `resolveCharacterSectionContext`
  // hits Redis (and may fall through to a gateway API call on session miss),
  // which could blow the 3-second window under load. `deferReply({ ephemeral })`
  // establishes the response now; `editReply` / `followUp` fill it in later.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ctx = await resolveCharacterSectionContext(interaction, entityId, sectionId, config);
  if (ctx === null) {
    // sectionContext already `followUp`-ed the error (it detects the defer).
    return;
  }

  const overLength = detectOverLengthFields(ctx.section, ctx.data);
  if (overLength.length === 0) {
    // Edge case: data changed between warning and View Full click (e.g.,
    // a concurrent save trimmed fields). Let the user know there's
    // nothing to view specially.
    await interaction.editReply({
      content: '✅ No fields in this section exceed the edit limit. Nothing to display.',
    });
    return;
  }

  const attachments = overLength.map(f => {
    const content = (ctx.data as Record<string, unknown>)[f.fieldId];
    const textContent = typeof content === 'string' ? content : '';
    return new AttachmentBuilder(Buffer.from(textContent, 'utf-8'), {
      name: `${f.fieldId}.txt`,
    });
  });

  const plainLabel = stripLeadingEmoji(ctx.section.label);
  const summary = overLength
    .map(f => `• \`${f.fieldId}.txt\` — ${f.current.toLocaleString()} chars`)
    .join('\n');

  await interaction.editReply({
    content:
      `**Full content for "${plainLabel}"** (read-only):\n${summary}\n\n` +
      `These files hold the current, untruncated values. Editing this section ` +
      `via the dashboard would cut each field to its modal cap.`,
    files: attachments,
  });
  logger.info(
    { userId: interaction.user.id, entityId, sectionId, fields: overLength.length },
    'View Full served over-length field content'
  );
}

/**
 * "Cancel" handler — dismiss the warning and leave the dashboard as-is.
 */
export async function handleCancelEditButton(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: '✅ Edit cancelled.',
    embeds: [],
    components: [],
  });
}
