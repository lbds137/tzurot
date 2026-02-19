/**
 * Shapes Import Subcommand
 *
 * Validates import parameters and shows a confirmation embed with buttons.
 * Button clicks (confirm/cancel) are handled by interactionHandlers.ts,
 * which is routed through CommandHandler — not inline collectors.
 */

import {
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  type MessageComponentInteraction,
} from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi, GATEWAY_TIMEOUTS } from '../../utils/userGatewayClient.js';
import { ShapesCustomIds } from '../../utils/customIds.js';
import { sanitizeErrorForDiscord } from '../../utils/errorSanitization.js';
import { buildBackToBrowseRow } from './errorRecovery.js';

const logger = createLogger('shapes-import');

interface AuthStatusResponse {
  hasCredentials: boolean;
  service: string;
}

interface ImportResponse {
  success: boolean;
  importJobId: string;
  sourceSlug: string;
  importType: string;
  status: string;
}

export interface ImportParams {
  slug: string;
  importType: 'full' | 'memory_only';
  /** Skip the success embed — caller will show a detail view instead */
  suppressSuccessEmbed?: boolean;
}

/** Start the import after user confirms via button. Returns true on success. */
export async function startImport(
  buttonInteraction: MessageComponentInteraction,
  userId: string,
  params: ImportParams
): Promise<boolean> {
  const { slug, importType, suppressSuccessEmbed = false } = params;

  await buttonInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(DISCORD_COLORS.WARNING)
        .setTitle('⏳ Starting Import...')
        .setDescription(
          `Queuing ${importType === 'memory_only' ? 'memory-only ' : ''}import for **${slug}**...`
        ),
    ],
    components: [],
  });

  const importResult = await callGatewayApi<ImportResponse>('/user/shapes/import', {
    method: 'POST',
    userId,
    body: { sourceSlug: slug, importType },
    timeout: GATEWAY_TIMEOUTS.DEFERRED,
  });

  if (!importResult.ok) {
    const errorMsg =
      importResult.status === 409
        ? `An import for **${slug}** is already in progress. Check \`/shapes status\` for details.`
        : `Failed to start import: ${sanitizeErrorForDiscord(importResult.error)}`;

    // update() already acknowledged the interaction above; editReply() modifies the original message
    await buttonInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(DISCORD_COLORS.ERROR)
          .setTitle('❌ Import Failed')
          .setDescription(errorMsg),
      ],
      components: [buildBackToBrowseRow()],
    });
    return false;
  }

  // When called from the detail flow, the caller replaces this with the detail view immediately,
  // so skip the success embed to avoid a brief flash of "Import Started!" before the detail view.
  if (!suppressSuccessEmbed) {
    const successEmbed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.SUCCESS)
      .setTitle('📥 Import Started')
      .setDescription(
        `Import for **${slug}** is now running in the background.\n\n` +
          'Use `/shapes status` to check progress.'
      )
      .addFields({ name: 'Job ID', value: `\`${importResult.data.importJobId}\``, inline: true })
      .setTimestamp();

    // update() already acknowledged the interaction; editReply() modifies the original message
    await buttonInteraction.editReply({ embeds: [successEmbed], components: [] });
  }

  logger.info(
    { userId, slug, importJobId: importResult.data.importJobId },
    '[Shapes] Import started'
  );

  return true;
}

/**
 * Handle /shapes import <slug> subcommand
 * Checks auth, shows confirmation embed with buttons.
 * Button clicks are handled by interactionHandlers.ts via CommandHandler routing.
 */
export async function handleImport(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const slug = context.interaction.options.getString('slug', true).trim().toLowerCase();
  const importTypeRaw = context.interaction.options.getString('import_type') ?? 'full';
  const importType: 'full' | 'memory_only' =
    importTypeRaw === 'memory_only' ? 'memory_only' : 'full';

  try {
    // 1. Check credentials exist
    const authResult = await callGatewayApi<AuthStatusResponse>('/user/shapes/auth/status', {
      userId,
      timeout: GATEWAY_TIMEOUTS.DEFERRED,
    });

    if (!authResult.ok || !authResult.data.hasCredentials) {
      await context.editReply({
        content:
          '❌ No shapes.inc credentials found.\n\n' +
          'Use `/shapes auth` to store your session cookie first.',
      });
      return;
    }

    // 2. Show confirmation embed with buttons
    // Slug is stored in the embed footer so the confirm handler can extract
    // it at click time — keeps it out of the custom ID (100-char limit).
    const isMemoryOnly = importType === 'memory_only';
    const confirmEmbed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.BLURPLE)
      .setTitle(isMemoryOnly ? '📥 Import Memories from Shapes.inc' : '📥 Import from Shapes.inc')
      .setDescription(
        isMemoryOnly
          ? `Ready to import memories from **${slug}** into the existing personality.\n\n` +
              'This will:\n' +
              '• Look up the previously imported personality by slug\n' +
              '• Fetch all conversation memories from shapes.inc\n' +
              '• Import them (deduplicating against existing memories)\n\n' +
              'Existing personality config will not be changed.'
          : `Ready to import **${slug}** from shapes.inc.\n\n` +
              'This will:\n' +
              '• Create a new personality with the character config\n' +
              '• Download the character avatar\n' +
              '• Import all conversation memories\n' +
              '• Set up the LLM configuration\n\n' +
              'The import runs in the background and may take a few minutes for characters with many memories.'
      )
      .setFooter({ text: `slug:${slug}` })
      .setTimestamp();

    const confirmButton = new ButtonBuilder()
      .setCustomId(ShapesCustomIds.importConfirm(importType))
      .setLabel('Start Import')
      .setEmoji('📥')
      .setStyle(ButtonStyle.Primary);

    const cancelButton = new ButtonBuilder()
      .setCustomId(ShapesCustomIds.importCancel())
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

    await context.editReply({ embeds: [confirmEmbed], components: [row] });
  } catch (error) {
    logger.error({ err: error, userId, slug }, '[Shapes] Unexpected error starting import');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
