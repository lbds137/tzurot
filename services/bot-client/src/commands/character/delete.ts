/**
 * Character Delete Handler
 *
 * Permanently deletes a character and ALL associated data:
 * - Conversation history
 * - Long-term memories
 * - Pending memories
 * - Activated channels
 * - Aliases
 * - Cached avatar
 *
 * This is a destructive operation with a confirmation step.
 *
 * IMPORTANT: This uses the global button handler pattern instead of awaitMessageComponent
 * because awaitMessageComponent doesn't work reliably in multi-replica deployments -
 * the button click may arrive at a different replica than the one waiting.
 */

import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import {
  createLogger,
  type EnvConfig,
  DeletePersonalityResponseSchema,
  DISCORD_COLORS,
} from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { fetchCharacter } from './api.js';
import { CharacterCustomIds } from '../../utils/customIds.js';

const logger = createLogger('character-delete');

/**
 * Handle the delete subcommand - show confirmation dialog
 * The actual deletion is handled by handleDeleteButton when user clicks confirm
 */
export async function handleDelete(
  context: DeferredCommandContext,
  config: EnvConfig
): Promise<void> {
  const slug = context.interaction.options.getString('character', true);
  const userId = context.user.id;

  try {
    // Fetch character to verify existence and ownership
    const character = await fetchCharacter(slug, config, userId);
    if (!character) {
      await context.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }

    // Use server-side permission check
    if (!character.canEdit) {
      await context.editReply(
        `❌ You don't have permission to delete \`${slug}\`.\n` +
          'You can only delete characters you own.'
      );
      return;
    }

    // Build confirmation embed with warning
    const embed = new EmbedBuilder()
      .setTitle('⚠️ Delete Character')
      .setDescription(
        `Are you sure you want to **permanently delete** \`${character.name}\`?\n\n` +
          '**This action is irreversible and will delete:**\n' +
          '• All conversation history\n' +
          '• All long-term memories\n' +
          '• All pending memories\n' +
          '• All activated channels\n' +
          '• All aliases\n' +
          '• Cached avatar'
      )
      .setColor(DISCORD_COLORS.ERROR);

    // Build confirmation buttons using CharacterCustomIds pattern
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(CharacterCustomIds.deleteConfirm(slug))
        .setLabel('Delete Forever')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(CharacterCustomIds.deleteCancel(slug))
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    await context.editReply({
      embeds: [embed],
      components: [buttons],
    });

    logger.info({ userId, slug }, '[Character] Showing delete confirmation');
  } catch (error) {
    logger.error({ err: error, slug }, '[Character] Delete command failed');
    await context.editReply({
      content: '❌ Failed to process delete command. Please try again.',
      embeds: [],
      components: [],
    });
  }
}

/**
 * Handle delete confirmation button click
 * Called from the global button handler in dashboard.ts
 */
export async function handleDeleteButton(
  interaction: ButtonInteraction,
  slug: string,
  confirmed: boolean
): Promise<void> {
  if (!confirmed) {
    await interaction.update({
      content: '✅ Deletion cancelled.',
      embeds: [],
      components: [],
    });
    return;
  }

  // User clicked confirm - proceed with deletion
  await interaction.update({
    content: '🔄 Deleting character...',
    embeds: [],
    components: [],
  });

  // Call the DELETE API
  const result = await callGatewayApi<unknown>(`/user/personality/${slug}`, {
    method: 'DELETE',
    userId: interaction.user.id,
  });

  if (!result.ok) {
    logger.error({ slug, error: result.error }, '[Character] Delete API failed');
    await interaction.editReply({
      content: `❌ Failed to delete character: ${result.error}`,
      embeds: [],
      components: [],
    });
    return;
  }

  // Validate response against schema (contract validation)
  const parseResult = DeletePersonalityResponseSchema.safeParse(result.data);
  if (!parseResult.success) {
    logger.error(
      { slug, parseError: parseResult.error.message },
      '[Character] Response schema validation failed'
    );
    // Still consider it a success since the API returned 200
    await interaction.editReply({
      content: `✅ Character has been deleted.`,
      embeds: [],
      components: [],
    });
    return;
  }

  const { deletedCounts: counts, deletedName, deletedSlug } = parseResult.data;

  // Build success message with deletion counts (filter out zero counts)
  const countLines = [
    counts.conversationHistory > 0 && `• ${counts.conversationHistory} conversation message(s)`,
    counts.memories > 0 &&
      `• ${counts.memories} long-term memor${counts.memories === 1 ? 'y' : 'ies'}`,
    counts.pendingMemories > 0 &&
      `• ${counts.pendingMemories} pending memor${counts.pendingMemories === 1 ? 'y' : 'ies'}`,
    counts.channelSettings > 0 && `• ${counts.channelSettings} channel setting(s)`,
    counts.aliases > 0 && `• ${counts.aliases} alias(es)`,
  ].filter((line): line is string => typeof line === 'string');

  let successMessage = `✅ Character \`${deletedName}\` has been permanently deleted.`;
  if (countLines.length > 0) {
    successMessage += '\n\n**Deleted data:**\n' + countLines.join('\n');
  }

  await interaction.editReply({
    content: successMessage,
    embeds: [],
    components: [],
  });

  logger.info(
    { userId: interaction.user.id, slug: deletedSlug, counts },
    '[Character] Successfully deleted character'
  );
}
