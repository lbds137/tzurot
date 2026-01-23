/**
 * Character Delete Handler
 *
 * Handles deletion confirmation button clicks from the character dashboard.
 * Permanently deletes a character and ALL associated data:
 * - Conversation history
 * - Long-term memories
 * - Pending memories
 * - Activated channels
 * - Aliases
 * - Cached avatar
 *
 * Note: The confirmation dialog is shown via the dashboard (handleDeleteAction in dashboard.ts).
 * This module only handles the button clicks after the user sees the confirmation.
 *
 * IMPORTANT: This uses the global button handler pattern instead of awaitMessageComponent
 * because awaitMessageComponent doesn't work reliably in multi-replica deployments -
 * the button click may arrive at a different replica than the one waiting.
 */

import type { ButtonInteraction } from 'discord.js';
import { createLogger, DeletePersonalityResponseSchema } from '@tzurot/common-types';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

const logger = createLogger('character-delete');

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
