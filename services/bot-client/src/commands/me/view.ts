/**
 * Me View Handler
 *
 * Displays the user's current profile information including:
 * - Preferred name
 * - Pronouns
 * - Content/description
 * - Settings (like LTM sharing)
 */

import { MessageFlags, EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, getPrismaClient } from '@tzurot/common-types';

const logger = createLogger('me-view');

/**
 * Handle /me view command
 */
export async function handleViewPersona(interaction: ChatInputCommandInteraction): Promise<void> {
  const prisma = getPrismaClient();
  const discordId = interaction.user.id;

  try {
    // Find user and their default profile
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        id: true,
        defaultPersona: {
          select: {
            id: true,
            name: true,
            preferredName: true,
            pronouns: true,
            content: true,
            description: true,
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

    const persona = user.defaultPersona;

    if (persona === null || persona === undefined) {
      await interaction.reply({
        content: "❌ You don't have a profile set up yet. Use `/me edit` to create one!",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    // Build embed with profile information
    const embed = new EmbedBuilder()
      .setTitle('🎭 Your Profile')
      .setColor(0x5865f2) // Discord blurple
      .setTimestamp();

    // Add fields
    if (persona.preferredName !== null && persona.preferredName.length > 0) {
      embed.addFields({ name: '📛 Preferred Name', value: persona.preferredName, inline: true });
    }

    if (persona.pronouns !== null && persona.pronouns.length > 0) {
      embed.addFields({ name: '🏷️ Pronouns', value: persona.pronouns, inline: true });
    }

    // Settings
    const ltmStatus = persona.shareLtmAcrossPersonalities
      ? '✅ Enabled - Memories shared across all personalities'
      : '❌ Disabled - Memories kept per personality';
    embed.addFields({ name: '🔗 LTM Sharing', value: ltmStatus, inline: false });

    // Content (truncate if too long)
    if (persona.content !== null && persona.content.length > 0) {
      const content =
        persona.content.length > 1000
          ? persona.content.substring(0, 1000) + '...'
          : persona.content;
      embed.addFields({ name: '📝 Content', value: content, inline: false });
    } else {
      embed.addFields({
        name: '📝 Content',
        value: '*No content set. Use `/me edit` to add information about yourself.*',
        inline: false,
      });
    }

    // Footer with help
    embed.setFooter({
      text: 'Use /me edit to update • /me settings to change options',
    });

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });

    logger.info({ userId: discordId }, '[Me] User viewed their profile');
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me] Failed to view profile');
    await interaction.reply({
      content: '❌ Failed to retrieve your profile. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
