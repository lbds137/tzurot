/**
 * Shapes Import Subcommand
 *
 * Starts a shapes.inc character import into Tzurot.
 * Checks credentials, validates the slug, then enqueues the import job.
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

/** Start the import after user confirms via button */
async function startImport(
  buttonInteraction: MessageComponentInteraction,
  userId: string,
  slug: string
): Promise<void> {
  await buttonInteraction.update({
    embeds: [
      new EmbedBuilder()
        .setColor(DISCORD_COLORS.WARNING)
        .setTitle('⏳ Starting Import...')
        .setDescription(`Queuing import for **${slug}**...`),
    ],
    components: [],
  });

  const importResult = await callGatewayApi<ImportResponse>('/user/shapes/import', {
    method: 'POST',
    userId,
    body: { sourceSlug: slug, importType: 'full' },
    timeout: GATEWAY_TIMEOUTS.DEFERRED,
  });

  if (!importResult.ok) {
    const errorMsg =
      importResult.status === 409
        ? `An import for **${slug}** is already in progress. Check \`/shapes status\` for details.`
        : `Failed to start import: ${importResult.error}`;

    await buttonInteraction.editReply({
      embeds: [
        new EmbedBuilder()
          .setColor(DISCORD_COLORS.ERROR)
          .setTitle('❌ Import Failed')
          .setDescription(errorMsg),
      ],
      components: [],
    });
    return;
  }

  const successEmbed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.SUCCESS)
    .setTitle('📥 Import Started')
    .setDescription(
      `Import for **${slug}** is now running in the background.\n\n` +
        'Use `/shapes status` to check progress.'
    )
    .addFields({ name: 'Job ID', value: `\`${importResult.data.importJobId}\``, inline: true })
    .setTimestamp();

  await buttonInteraction.editReply({ embeds: [successEmbed], components: [] });

  logger.info(
    { userId, slug, importJobId: importResult.data.importJobId },
    '[Shapes] Import started'
  );
}

/**
 * Handle /shapes import <slug> subcommand
 * Checks auth, confirms with user, then starts the import
 */
export async function handleImport(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const slug = context.interaction.options.getString('slug', true).trim().toLowerCase();

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

    // 2. Show confirmation embed
    const confirmEmbed = new EmbedBuilder()
      .setColor(DISCORD_COLORS.BLURPLE)
      .setTitle('📥 Import from Shapes.inc')
      .setDescription(
        `Ready to import **${slug}** from shapes.inc.\n\n` +
          'This will:\n' +
          '• Create a new personality with the character config\n' +
          '• Import all conversation memories\n' +
          '• Set up the LLM configuration\n\n' +
          'The import runs in the background and may take a few minutes for characters with many memories.'
      )
      .setTimestamp();

    const confirmButton = new ButtonBuilder()
      .setCustomId('shapes-import-confirm')
      .setLabel('Start Import')
      .setEmoji('📥')
      .setStyle(ButtonStyle.Primary);

    const cancelButton = new ButtonBuilder()
      .setCustomId('shapes-import-cancel')
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmButton, cancelButton);

    const response = await context.editReply({ embeds: [confirmEmbed], components: [row] });

    // 3. Wait for button interaction
    try {
      const buttonInteraction = await response.awaitMessageComponent({
        filter: i => i.user.id === userId,
        time: 60_000,
      });

      if (buttonInteraction.customId === 'shapes-import-cancel') {
        await buttonInteraction.update({
          content: 'Import cancelled.',
          embeds: [],
          components: [],
        });
        return;
      }

      await startImport(buttonInteraction, userId, slug);
    } catch {
      // Timeout waiting for button click
      await context.editReply({
        content: 'Import confirmation timed out.',
        embeds: [],
        components: [],
      });
    }
  } catch (error) {
    logger.error({ err: error, userId, slug }, '[Shapes] Unexpected error starting import');
    await context.editReply({ content: '❌ An unexpected error occurred. Please try again.' });
  }
}
