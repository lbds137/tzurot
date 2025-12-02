/**
 * Persona List Handler
 *
 * Lists all personas owned by the user.
 * Shows which one is the default and basic info about each.
 */

import { MessageFlags, EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, getPrismaClient, DISCORD_COLORS, TEXT_LIMITS } from '@tzurot/common-types';

const logger = createLogger('persona-list');

/**
 * Handle /persona list command
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
          "📋 **You don't have any personas yet.**\n\n" +
          'Use `/persona create` to create your first persona, or `/persona edit` to set up your default persona.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Your Personas')
      .setColor(DISCORD_COLORS.BLURPLE)
      .setDescription(
        `You have **${user.ownedPersonas.length}** persona${user.ownedPersonas.length === 1 ? '' : 's'}.`
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
      text: 'Use /persona edit <persona> to edit • /persona default <persona> to change default',
    });

    await interaction.reply({
      embeds: [embed],
      flags: MessageFlags.Ephemeral,
    });

    logger.info(
      { userId: discordId, personaCount: user.ownedPersonas.length },
      '[Persona] Listed personas'
    );
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Persona] Failed to list personas');
    await interaction.reply({
      content: '❌ Failed to load your personas. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
