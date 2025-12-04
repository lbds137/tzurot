/**
 * Me Default Handler
 *
 * Sets a profile as the user's default profile.
 * The default profile is used when no personality-specific override is set.
 */

import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, getPrismaClient } from '@tzurot/common-types';
import { personaCacheInvalidationService } from '../../redis.js';

const logger = createLogger('me-default');

/**
 * Handle /me profile default <profile> command
 */
export async function handleSetDefaultPersona(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const prisma = getPrismaClient();
  const discordId = interaction.user.id;
  const personaId = interaction.options.getString('profile', true);

  try {
    // Find user
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        id: true,
        defaultPersonaId: true,
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

    // Verify the profile belongs to this user
    const persona = await prisma.persona.findFirst({
      where: {
        id: personaId,
        ownerId: user.id,
      },
      select: {
        id: true,
        name: true,
        preferredName: true,
      },
    });

    if (persona === null) {
      await interaction.reply({
        content: '❌ Profile not found. Use `/me profile list` to see your profiles.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Check if already default
    if (user.defaultPersonaId === personaId) {
      const displayName = persona.preferredName ?? persona.name;
      await interaction.reply({
        content: `ℹ️ **${displayName}** is already your default profile.`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Update default profile
    await prisma.user.update({
      where: { id: user.id },
      data: { defaultPersonaId: personaId },
    });

    // Broadcast cache invalidation
    await personaCacheInvalidationService.invalidateUserPersona(discordId);

    const displayName = persona.preferredName ?? persona.name;
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
