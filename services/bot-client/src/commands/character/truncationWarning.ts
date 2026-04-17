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
import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  InteractionReplyOptions,
} from 'discord.js';
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
  // Strip a leading emoji + whitespace from the section label the same
  // way ModalFactory does for modal titles.
  const plainLabel = sectionLabel.replace(/^[^\w\s]+\s*/, '');

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
      text: `${totalLoss.toLocaleString()} total characters would be truncated across ${overLength.length} field(s)`,
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
      .setCustomId(buildDashboardCustomId('character', 'edit-truncated', entityId, sectionId))
      .setLabel('Edit with Truncation')
      .setEmoji('✂️')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId('character', 'view-full', entityId, sectionId))
      .setLabel('View Full')
      .setEmoji('📖')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(buildDashboardCustomId('character', 'cancel-edit', entityId, sectionId))
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
 */
export async function handleEditTruncatedButton(
  interaction: ButtonInteraction,
  entityId: string,
  sectionId: string,
  config: EnvConfig = getConfig()
): Promise<void> {
  const ctx = await resolveCharacterSectionContext(interaction, entityId, sectionId, config);
  if (ctx === null) {return;}

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
  const ctx = await resolveCharacterSectionContext(interaction, entityId, sectionId, config);
  if (ctx === null) {return;}

  const overLength = detectOverLengthFields(ctx.section, ctx.data);
  if (overLength.length === 0) {
    // Edge case: data changed between warning and View Full click (e.g.,
    // a concurrent save trimmed fields). Let the user know there's
    // nothing to view specially.
    await interaction.reply({
      content: '✅ No fields in this section exceed the edit limit. Nothing to display.',
      flags: MessageFlags.Ephemeral,
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

  const plainLabel = ctx.section.label.replace(/^[^\w\s]+\s*/, '');
  const summary = overLength
    .map(f => `• \`${f.fieldId}.txt\` — ${f.current.toLocaleString()} chars`)
    .join('\n');

  const payload: InteractionReplyOptions = {
    content:
      `**Full content for "${plainLabel}"** (read-only):\n${summary}\n\n` +
      `These files hold the current, untruncated values. Editing this section ` +
      `via the dashboard would cut each field to its modal cap.`,
    files: attachments,
    flags: MessageFlags.Ephemeral,
  };

  await interaction.reply(payload);
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
