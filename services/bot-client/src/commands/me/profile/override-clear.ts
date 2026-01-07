/**
 * Me Override Clear Handler
 *
 * Allows users to clear profile overrides for specific personalities.
 * After clearing, the user's default profile will be used instead.
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';

const logger = createLogger('me-override-clear');

/** Response type for clearing override */
interface ClearOverrideResponse {
  success: boolean;
  personality: {
    id: string;
    name: string;
    displayName: string | null;
  };
  hadOverride: boolean;
}

/**
 * Handle /me profile override-clear <personality> - Remove override
 */
export async function handleOverrideClear(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordId = interaction.user.id;
  const personalitySlug = interaction.options.getString('personality', true);

  try {
    // Clear override via gateway
    const result = await callGatewayApi<ClearOverrideResponse>(
      `/user/persona/override/${personalitySlug}`,
      {
        userId: discordId,
        method: 'DELETE',
      }
    );

    if (!result.ok) {
      // Handle specific errors
      if (result.error?.includes('Personality not found') || result.error?.includes('not found')) {
        await interaction.editReply({
          content: `❌ Personality "${personalitySlug}" not found.`,
        });
        return;
      }

      if (result.error?.includes('no account') || result.error?.includes('User')) {
        await interaction.editReply({
          content:
            "❌ You don't have an account yet. Send a message to any personality to create one!",
        });
        return;
      }

      logger.warn(
        { userId: discordId, personalitySlug, error: result.error },
        '[Me] Failed to clear override via gateway'
      );
      await interaction.editReply({
        content: '❌ Failed to clear profile override. Please try again later.',
      });
      return;
    }

    const { personality, hadOverride } = result.data;
    const personalityName = personality.displayName ?? personality.name;

    if (!hadOverride) {
      await interaction.editReply({
        content: `ℹ️ You don't have a profile override set for ${personalityName}.`,
      });
      return;
    }

    logger.info(
      { userId: discordId, personalityId: personality.id },
      '[Me] Cleared profile override'
    );

    await interaction.editReply({
      content: `✅ **Profile override cleared for ${personalityName}!**\n\nYour default profile will now be used when talking to ${personalityName}.`,
    });
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me] Failed to clear override');
    await interaction.editReply({
      content: '❌ Failed to clear profile override. Please try again later.',
    });
  }
}
