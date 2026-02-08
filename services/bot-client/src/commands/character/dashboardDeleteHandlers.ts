/**
 * Dashboard delete action handlers.
 *
 * Handles the delete confirmation flow for character dashboards:
 * - Show confirmation dialog from dashboard delete button
 * - Process confirm/cancel responses
 */

import { MessageFlags } from 'discord.js';
import type { ButtonInteraction } from 'discord.js';
import {
  createLogger,
  DeletePersonalityResponseSchema,
  type EnvConfig,
} from '@tzurot/common-types';
import { buildDeleteConfirmation } from '../../utils/dashboard/deleteConfirmation.js';
import { DASHBOARD_MESSAGES } from '../../utils/dashboard/messages.js';
import { CharacterCustomIds } from '../../utils/customIds.js';
import { fetchCharacter } from './api.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('character-dashboard');

/**
 * Handle delete button click from dashboard - show confirmation dialog
 */
export async function handleDeleteAction(
  interaction: ButtonInteraction,
  slug: string,
  config: EnvConfig
): Promise<void> {
  // Re-fetch to verify current state and permissions
  const character = await fetchCharacter(slug, config, interaction.user.id);
  if (!character) {
    await interaction.reply({
      content: DASHBOARD_MESSAGES.NOT_FOUND('Character'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Verify user can delete
  if (!character.canEdit) {
    await interaction.reply({
      content: DASHBOARD_MESSAGES.NO_PERMISSION('delete this character'),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // Build confirmation dialog using shared utility
  const displayName = character.displayName ?? character.name;
  const { embed, components } = buildDeleteConfirmation({
    entityType: 'Character',
    entityName: displayName,
    confirmCustomId: CharacterCustomIds.deleteConfirm(slug),
    cancelCustomId: CharacterCustomIds.deleteCancel(slug),
    title: '⚠️ Delete Character?',
    confirmLabel: 'Delete Forever',
    deletedItems: [
      'Conversation history',
      'Long-term memories',
      'Pending memories',
      'Activated channels',
      'Aliases',
      'Cached avatar',
    ],
  });

  await interaction.update({ embeds: [embed], components });

  logger.info({ userId: interaction.user.id, slug }, 'Showing delete confirmation from dashboard');
}

/**
 * Handle delete confirmation button click.
 * Called when user clicks "Delete Forever" or "Cancel" on the delete confirmation dialog.
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
