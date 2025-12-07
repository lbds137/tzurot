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
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ComponentType,
} from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import {
  createLogger,
  type EnvConfig,
  DeletePersonalityResponseSchema,
  DISCORD_COLORS,
  DISCORD_LIMITS,
} from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';
import { fetchCharacter } from './api.js';

const logger = createLogger('character-delete');

/** Custom ID prefix for delete confirmation buttons */
const DELETE_CONFIRM_ID = 'character_delete_confirm';
const DELETE_CANCEL_ID = 'character_delete_cancel';

/**
 * Handle the delete subcommand - show confirmation and delete character
 */
export async function handleDelete(
  interaction: ChatInputCommandInteraction,
  config: EnvConfig
): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const slug = interaction.options.getString('character', true);

  try {
    // Fetch character to verify existence and ownership
    const character = await fetchCharacter(slug, config, interaction.user.id);
    if (!character) {
      await interaction.editReply(`❌ Character \`${slug}\` not found or not accessible.`);
      return;
    }

    // Use server-side permission check
    if (!character.canEdit) {
      await interaction.editReply(
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
          '• Cached avatar\n\n' +
          '**Type the character slug to confirm:** `' +
          slug +
          '`'
      )
      .setColor(DISCORD_COLORS.ERROR);

    // Build confirmation buttons
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(DELETE_CONFIRM_ID)
        .setLabel('Delete Forever')
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(DELETE_CANCEL_ID)
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary)
    );

    const reply = await interaction.editReply({
      embeds: [embed],
      components: [buttons],
    });

    // Wait for button interaction (30 second timeout)
    try {
      const buttonInteraction = await reply.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: i => i.user.id === interaction.user.id,
        time: DISCORD_LIMITS.BUTTON_COLLECTOR_TIMEOUT,
      });

      if (buttonInteraction.customId === DELETE_CANCEL_ID) {
        await buttonInteraction.update({
          content: '✅ Deletion cancelled.',
          embeds: [],
          components: [],
        });
        return;
      }

      // User clicked confirm - proceed with deletion
      await buttonInteraction.update({
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
          content: `✅ Character \`${character.name}\` has been deleted.`,
          embeds: [],
          components: [],
        });
        return;
      }

      const deleteResponse = parseResult.data;
      const counts = deleteResponse.deletedCounts;

      // Build success message with deletion counts
      const countLines: string[] = [];
      if (counts.conversationHistory > 0) {
        countLines.push(`• ${counts.conversationHistory} conversation message(s)`);
      }
      if (counts.memories > 0) {
        countLines.push(
          `• ${counts.memories} long-term memor${counts.memories === 1 ? 'y' : 'ies'}`
        );
      }
      if (counts.pendingMemories > 0) {
        countLines.push(
          `• ${counts.pendingMemories} pending memor${counts.pendingMemories === 1 ? 'y' : 'ies'}`
        );
      }
      if (counts.activatedChannels > 0) {
        countLines.push(`• ${counts.activatedChannels} activated channel(s)`);
      }
      if (counts.aliases > 0) {
        countLines.push(`• ${counts.aliases} alias(es)`);
      }

      let successMessage = `✅ Character \`${deleteResponse.deletedName}\` has been permanently deleted.`;
      if (countLines.length > 0) {
        successMessage += '\n\n**Deleted data:**\n' + countLines.join('\n');
      }

      await interaction.editReply({
        content: successMessage,
        embeds: [],
        components: [],
      });

      logger.info(
        {
          userId: interaction.user.id,
          slug: deleteResponse.deletedSlug,
          counts,
        },
        '[Character] Successfully deleted character'
      );
    } catch (error) {
      // Timeout or other collector error
      if ((error as Error).message?.includes('time')) {
        await interaction.editReply({
          content: '⏱️ Confirmation timed out. Deletion cancelled.',
          embeds: [],
          components: [],
        });
        return;
      }
      throw error;
    }
  } catch (error) {
    logger.error({ err: error, slug }, '[Character] Delete command failed');
    await interaction.editReply({
      content: '❌ Failed to process delete command. Please try again.',
      embeds: [],
      components: [],
    });
  }
}
