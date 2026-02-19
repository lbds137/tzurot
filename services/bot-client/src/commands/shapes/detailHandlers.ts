/**
 * Shapes Detail View Handlers
 *
 * Handles button interactions from the shape detail view:
 * import confirmation, export, refresh, and cancel flows.
 *
 * Extracted from interactionHandlers.ts to keep the main router
 * within the ESLint max-lines limit.
 */

import type { ButtonInteraction, StringSelectMenuInteraction } from 'discord.js';
import { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { ShapesCustomIds } from '../../utils/customIds.js';
import { startImport } from './import.js';
import { startExport } from './export.js';
import { buildShapeDetailEmbed } from './detail.js';

const logger = createLogger('shapes-detail-handlers');

// Shapes.inc usernames: 1-50 chars, lowercase alphanumeric + hyphens, no leading/trailing hyphens
const SLUG_PATTERN = /^[a-z0-9]([a-z0-9-]{0,48}[a-z0-9])?$/;
const INVALID_STATE_MSG = '\u274C Invalid state. Please try again from the browse list.';

/** Extract slug from embed footer (format: "slug:xxx" or "slug:xxx::detail") */
export function parseSlugFromFooter(interaction: ButtonInteraction): {
  slug: string | undefined;
  isFromDetail: boolean;
} {
  const footerText = interaction.message.embeds[0]?.footer?.text ?? '';
  const isFromDetail = footerText.endsWith('::detail');
  // Safe without /g flag: SLUG_PATTERN enforces [a-z0-9-] only, so "::detail" can't appear in a slug
  const raw = footerText.replace('::detail', '');
  const rawSlug = raw.startsWith('slug:') ? raw.slice(5) : undefined;
  const slug = rawSlug !== undefined && SLUG_PATTERN.test(rawSlug) ? rawSlug : undefined;
  return { slug, isFromDetail };
}

/** Show the detail view for a selected shape */
export async function showDetailView(
  interaction: ButtonInteraction | StringSelectMenuInteraction,
  slug: string
): Promise<void> {
  const userId = interaction.user.id;
  const { embed, components } = await buildShapeDetailEmbed(userId, slug);
  await interaction.update({
    embeds: [embed],
    components,
  });
}

/** Handle import button from detail view — show confirmation */
export async function handleDetailImport(
  interaction: ButtonInteraction,
  importType: string | undefined
): Promise<void> {
  const { slug } = parseSlugFromFooter(interaction);
  if (slug === undefined || importType === undefined) {
    await interaction.update({
      content: INVALID_STATE_MSG,
      embeds: [],
      components: [],
    });
    return;
  }

  const isMemoryOnly = importType === 'memory_only';
  const confirmEmbed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle(
      isMemoryOnly
        ? '\uD83D\uDCE5 Import Memories from Shapes.inc'
        : '\uD83D\uDCE5 Import from Shapes.inc'
    )
    .setDescription(
      isMemoryOnly
        ? `Ready to import memories from **${slug}** into the existing personality.\n\n` +
            'This will:\n' +
            '\u2022 Look up the previously imported personality by slug\n' +
            '\u2022 Fetch all conversation memories from shapes.inc\n' +
            '\u2022 Import them (deduplicating against existing memories)\n\n' +
            'Existing personality config will not be changed.'
        : `Ready to import **${slug}** from shapes.inc.\n\n` +
            'This will:\n' +
            '\u2022 Create a new personality with the character config\n' +
            '\u2022 Download the character avatar\n' +
            '\u2022 Import all conversation memories\n' +
            '\u2022 Set up the LLM configuration\n\n' +
            'The import runs in the background and may take a few minutes.'
    )
    .setFooter({ text: `slug:${slug}::detail` })
    .setTimestamp();

  const confirmButton = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.importConfirm(importType))
    .setLabel('Start Import')
    .setEmoji('\uD83D\uDCE5')
    .setStyle(ButtonStyle.Primary);

  const cancelButton = new ButtonBuilder()
    .setCustomId(ShapesCustomIds.importCancel())
    .setLabel('Cancel')
    .setStyle(ButtonStyle.Secondary);

  await interaction.update({
    embeds: [confirmEmbed],
    components: [new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton)],
  });
}

/** Handle export button from detail view — start export immediately */
export async function handleDetailExport(
  interaction: ButtonInteraction,
  exportFormat: string | undefined
): Promise<void> {
  const { slug } = parseSlugFromFooter(interaction);
  if (slug === undefined || exportFormat === undefined) {
    await interaction.update({
      content: INVALID_STATE_MSG,
      embeds: [],
      components: [],
    });
    return;
  }

  const format: 'json' | 'markdown' = exportFormat === 'markdown' ? 'markdown' : 'json';
  const userId = interaction.user.id;

  const success = await startExport(interaction, userId, { slug, format });
  if (success) {
    // Show detail view with updated job status
    const { embed, components } = await buildShapeDetailEmbed(userId, slug);
    await interaction.editReply({
      embeds: [embed],
      components,
    });
  }
}

/** Handle refresh button — re-fetch and show detail view */
export async function handleDetailRefresh(interaction: ButtonInteraction): Promise<void> {
  const { slug } = parseSlugFromFooter(interaction);
  if (slug === undefined) {
    await interaction.update({
      content: INVALID_STATE_MSG,
      embeds: [],
      components: [],
    });
    return;
  }

  await showDetailView(interaction, slug);
}

/** Handle import cancel — return to detail view if triggered from there */
export async function handleImportCancel(interaction: ButtonInteraction): Promise<void> {
  const { slug, isFromDetail } = parseSlugFromFooter(interaction);

  if (isFromDetail && slug !== undefined) {
    await showDetailView(interaction, slug);
    return;
  }

  await interaction.update({ content: 'Import cancelled.', embeds: [], components: [] });
}

/** Parse import state from custom ID + embed and start the import */
export async function handleImportConfirm(
  interaction: ButtonInteraction,
  parsed: NonNullable<ReturnType<typeof ShapesCustomIds.parse>>
): Promise<void> {
  const userId = interaction.user.id;

  const VALID_IMPORT_TYPES = ['full', 'memory_only'] as const;
  const rawType = parsed.importType;
  const importType = VALID_IMPORT_TYPES.includes(rawType as 'full' | 'memory_only')
    ? (rawType as 'full' | 'memory_only')
    : undefined;

  const { slug, isFromDetail } = parseSlugFromFooter(interaction);

  if (slug === undefined || importType === undefined) {
    logger.warn({ customId: interaction.customId }, '[Shapes] Import confirm missing state');
    await interaction.update({
      content: '\u274C Invalid import state. Please try `/shapes import` again.',
      embeds: [],
      components: [],
    });
    return;
  }

  const success = await startImport(interaction, userId, {
    slug,
    importType,
    suppressSuccessEmbed: isFromDetail,
  });

  // If triggered from detail view and import succeeded, show detail view with job status
  if (isFromDetail && success) {
    const { embed, components } = await buildShapeDetailEmbed(userId, slug);
    await interaction.editReply({
      embeds: [embed],
      components,
    });
  }
}
