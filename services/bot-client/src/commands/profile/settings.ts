/**
 * Profile Settings Handler
 *
 * Manages profile settings like LTM (Long-Term Memory) sharing across personalities.
 */

import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, getPrismaClient } from '@tzurot/common-types';
import { personaCacheInvalidationService } from '../../redis.js';

const logger = createLogger('profile-settings');

/**
 * Handle /profile settings share-ltm command
 */
export async function handleShareLtmSetting(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const prisma = getPrismaClient();
  const discordId = interaction.user.id;
  const enabledValue = interaction.options.getString('enabled', true);
  const enabled = enabledValue === 'enable';

  try {
    // Find user and their default profile
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        id: true,
        defaultPersonaId: true,
        defaultPersona: {
          select: {
            shareLtmAcrossPersonalities: true,
          },
        },
      },
    });

    if (user === null) {
      await interaction.reply({
        content:
          "❌ You don't have an account yet. Send a message to any personality to create one!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const personaId = user.defaultPersonaId;

    if (personaId === null || personaId === undefined) {
      await interaction.reply({
        content: "❌ You don't have a profile set up yet. Use `/profile edit` to create one first!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const currentSetting = user.defaultPersona?.shareLtmAcrossPersonalities ?? false;

    // Check if already in desired state
    if (currentSetting === enabled) {
      const statusText = enabled
        ? 'already sharing memories across all personalities'
        : 'already keeping memories separate per personality';
      await interaction.reply({
        content: `ℹ️ LTM sharing is ${statusText}. No changes needed.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Update the setting
    await prisma.persona.update({
      where: { id: personaId },
      data: {
        shareLtmAcrossPersonalities: enabled,
        updatedAt: new Date(),
      },
    });

    const responseText = enabled
      ? '✅ **LTM sharing enabled!**\n\nYour memories will now be shared across all personalities. ' +
        'When you tell one personality something, all others will remember it too.'
      : '✅ **LTM sharing disabled!**\n\nYour memories will now be kept separate per personality. ' +
        "Each personality will only remember conversations you've had with them specifically.";

    await interaction.reply({
      content: responseText,
      flags: MessageFlags.Ephemeral,
    });

    logger.info(
      { userId: discordId, personaId, enabled },
      '[Profile] Updated shareLtmAcrossPersonalities setting'
    );

    // Broadcast cache invalidation to all ai-worker instances
    await personaCacheInvalidationService.invalidateUserPersona(discordId);
  } catch (error) {
    logger.error(
      { err: error, userId: discordId },
      '[Profile] Failed to update LTM sharing setting'
    );
    await interaction.reply({
      content: '❌ Failed to update LTM sharing setting. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
