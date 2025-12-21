/**
 * Me List Handler
 *
 * Lists all profiles owned by the user.
 * Shows which one is the default and basic info about each.
 *
 * Uses gateway API for all data access (no direct Prisma).
 */

import { MessageFlags, EmbedBuilder, escapeMarkdown } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import {
  createLogger,
  DISCORD_COLORS,
  TEXT_LIMITS,
  type ListPersonasResponse,
} from '@tzurot/common-types';
import { callGatewayApi } from '../../../utils/userGatewayClient.js';

const logger = createLogger('me-list');

/**
 * Handle /me profile list command
 */
export async function handleListPersonas(interaction: ChatInputCommandInteraction): Promise<void> {
  const discordId = interaction.user.id;

  try {
    // Fetch user's personas via gateway API
    const result = await callGatewayApi<ListPersonasResponse>('/user/persona', {
      userId: discordId,
    });

    if (!result.ok) {
      logger.warn({ userId: discordId, error: result.error }, '[Me] Failed to fetch personas');
      await interaction.reply({
        content: '❌ Failed to load your profiles. Please try again later.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (result.data.personas.length === 0) {
      await interaction.reply({
        content:
          "📋 **You don't have any profiles yet.**\n\n" +
          'Use `/me profile create` to create your first profile, or `/me profile edit` to set up your default profile.',
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const personas = result.data.personas;

    const embed = new EmbedBuilder()
      .setTitle('📋 Your Profiles')
      .setColor(DISCORD_COLORS.BLURPLE)
      .setDescription(
        `You have **${personas.length}** profile${personas.length === 1 ? '' : 's'}.`
      );

    for (const persona of personas) {
      const safeName = escapeMarkdown(persona.name);
      const fieldName = persona.isDefault ? `⭐ ${safeName} (default)` : safeName;

      const details: string[] = [];
      if (persona.preferredName !== undefined && persona.preferredName !== null) {
        details.push(`**Name:** ${escapeMarkdown(persona.preferredName)}`);
      }
      if (persona.pronouns !== undefined && persona.pronouns !== null) {
        details.push(`**Pronouns:** ${escapeMarkdown(persona.pronouns)}`);
      }
      // Check for both undefined and null since shared schema has content as optional
      const content = persona.content;
      if (content !== undefined && content !== null && content.length > 0) {
        const preview =
          content.length > TEXT_LIMITS.LOG_PERSONA_PREVIEW
            ? `${content.substring(0, TEXT_LIMITS.LOG_PERSONA_PREVIEW)}...`
            : content;
        details.push(`**About:** ${escapeMarkdown(preview)}`);
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

    logger.info({ userId: discordId, personaCount: personas.length }, '[Me] Listed profiles');
  } catch (error) {
    logger.error({ err: error, userId: discordId }, '[Me] Failed to list profiles');
    await interaction.reply({
      content: '❌ Failed to load your profiles. Please try again later.',
      flags: MessageFlags.Ephemeral,
    });
  }
}
