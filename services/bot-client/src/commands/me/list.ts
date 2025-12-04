/**
 * Me List Handler
 *
 * Lists all profiles owned by the user.
 * Shows which one is the default and basic info about each.
 */

import { MessageFlags, EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, getPrismaClient, DISCORD_COLORS, TEXT_LIMITS } from '@tzurot/common-types';

const logger = createLogger('me-list');

/**
 * Handle /me profile list command
 */
export async function handleListPersonas(interaction: ChatInputCommandInteraction): Promise<void> {
  const prisma = getPrismaClient();
  const discordId = interaction.user.id;

  try {
    const user = await prisma.user.findUnique({
      where: { discordId },
      select: {
        defaultPersonaId: true,
        ownedPersonas: {
          select: {
            id: true,
            name: true,
            preferredName: true,
            pronouns: true,
            content: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (user === null || user.ownedPersonas.length === 0) {
      await interaction.reply({
        content:
          "📋 **You don't have any profiles yet.**\n\n" +
          'Use `/me profile create` to create your first profile, or `/me profile edit` to set up your default profile.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Your Profiles')
      .setColor(DISCORD_COLORS.BLURPLE)
      .setDescription(
        `You have **${user.ownedPersonas.length}** profile${user.ownedPersonas.length === 1 ? '' : 's'}.`
      );

    for (const persona of user.ownedPersonas) {
      const isDefault = persona.id === user.defaultPersonaId;
      const fieldName = isDefault ? `⭐ ${persona.name} (default)` : persona.name;

      const details: string[] = [];
      if (persona.preferredName !== null) {
        details.push(`**Name:** ${persona.preferredName}`);
      }
      if (persona.pronouns !== null) {
        details.push(`**Pronouns:** ${persona.pronouns}`);
      }
      if (persona.content !== null && persona.content.length > 0) {
        const preview =
          persona.content.length > TEXT_LIMITS.LOG_PERSONA_PREVIEW
            ? `${persona.content.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW)}...`
            : persona.content;
        details.push(`**About:** ${preview}`);
      }

      const fieldValue = details.length > 0 ? details.join('\n') : '*No details set*';
      embed.addFields({ name: fieldName, value: fieldValue, inline: false });
    }

    embed.setFooter({
      text: 'Use /me profile edit <profile> to edit • /me profile default <profile> to change default',
    });

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });

    logger.info(
      { userId: discordId, personaCount: user.ownedPersonas.length },
      '[Me] Listed profiles'
    );
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me] Failed to list profiles');
    await interaction.reply({
      content: '❌ Failed to load your profiles. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
