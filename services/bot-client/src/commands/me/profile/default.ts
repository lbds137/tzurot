/**
 * Me Default Handler
 *
 * Sets a profile as the user's default profile.
 * The default profile is used when no personality-specific override is set.
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';

const logger = createLogger('me-default');

/** Response type for setting default persona */
interface SetDefaultResponse {
  success: boolean;
  persona: {
    id: string;
    name: string;
    preferredName: string | null;
  };
  alreadyDefault?: boolean;
}

/**
 * Handle /me profile default <profile> command
 */
export async function handleSetDefaultPersona(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const discordId = interaction.user.id;
  const personaId = interaction.options.getString('profile', true);

  try {
    // Set default via gateway API
    const result = await callGatewayApi<SetDefaultResponse>(`/user/persona/${personaId}/default`, {
      userId: discordId,
      method: 'PATCH',
    });

    if (!result.ok) {
      // Handle specific error cases
      if (result.error?.includes('not found') || result.error?.includes('Not found')) {
        await interaction.reply({
          content: '❌ Profile not found. Use `/me profile list` to see your profiles.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      logger.warn(
        { userId: discordId, personaId, error: result.error },
        '[Me] Failed to set default profile'
      );
      await interaction.reply({
        content: '❌ Failed to set default profile. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const { persona, alreadyDefault } = result.data;
    const displayName = persona.preferredName ?? persona.name;

    // Check if already default
    if (alreadyDefault === true) {
      await interaction.reply({
        content: `ℹ️ **${displayName}** is already your default profile.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    logger.info(
      { userId: discordId, personaId, personaName: persona.name },
      '[Me] Set default profile'
    );

    await interaction.reply({
      content: `⭐ **${displayName}** is now your default profile.\n\nThis profile will be used when talking to personalities that don't have a specific override set.`,
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me] Failed to set default profile');
    await interaction.reply({
      content: '❌ Failed to set default profile. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
