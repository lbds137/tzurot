/**
 * Me Settings Handler
 *
 * Manages profile settings like LTM (Long-Term Memory) sharing across personalities.
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';

const logger = createLogger('me-settings');

/** Response type for updating settings */
interface UpdateSettingsResponse {
  success: boolean;
  setting: {
    shareLtmAcrossPersonalities: boolean;
  };
  previousValue: boolean;
  unchanged?: boolean;
}

/**
 * Handle /me settings share-ltm command
 */
export async function handleShareLtmSetting(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordId = interaction.user.id;
  const enabledValue = interaction.options.getString('enabled', true);
  const enabled = enabledValue === 'enable';

  try {
    // Update setting via gateway API
    const result = await callGatewayApi<UpdateSettingsResponse>('/user/persona/settings', {
      userId: discordId,
      method: 'PATCH',
      body: {
        shareLtmAcrossPersonalities: enabled,
      },
    });

    if (!result.ok) {
      // Handle specific error cases
      if (result.error?.includes('no account') || result.error?.includes('Not found')) {
        await interaction.reply({
          content:
            "❌ You don't have an account yet. Send a message to any personality to create one!",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (result.error?.includes('no profile') || result.error?.includes('No default persona')) {
        await interaction.reply({
          content:
            "❌ You don't have a profile set up yet. Use `/me profile edit` to create one first!",
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      logger.warn(
        { userId: discordId, enabled, error: result.error },
        '[Me] Failed to update LTM sharing setting via gateway'
      );
      await interaction.reply({
        content: '❌ Failed to update LTM sharing setting. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if already in desired state
    if (result.data.unchanged === true) {
      const statusText = enabled
        ? 'already sharing memories across all personalities'
        : 'already keeping memories separate per personality';
      await interaction.reply({
        content: `ℹ️ LTM sharing is ${statusText}. No changes needed.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const responseText = enabled
      ? '✅ **LTM sharing enabled!**\n\nYour memories will now be shared across all personalities. ' +
        'When you tell one personality something, all others will remember it too.'
      : '✅ **LTM sharing disabled!**\n\nYour memories will now be kept separate per personality. ' +
        "Each personality will only remember conversations you've had with them specifically.";

    await interaction.reply({
      content: responseText,
      flags: MessageFlags.Ephemeral,
    });

    logger.info({ userId: discordId, enabled }, '[Me] Updated shareLtmAcrossPersonalities setting');
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me] Failed to update LTM sharing setting');
    await interaction.reply({
      content: '❌ Failed to update LTM sharing setting. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
