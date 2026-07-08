/**
 * Command Helpers
 * Shared utilities for Discord slash command handlers
 *
 * Provides the shared embed factories (success/info/error/warning/danger)
 * with consistent DISCORD_COLORS styling. Error-reply helpers formerly here
 * were dead code; error messaging now flows through ux/catalog + replySpec.
 */

import { EmbedBuilder } from 'discord.js';
import { DISCORD_COLORS } from '@tzurot/common-types/constants/discord';

/**
 * Create a success embed with consistent styling
 */
export function createSuccessEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(DISCORD_COLORS.SUCCESS)
    .setDescription(description)
    .setTimestamp();
}

/**
 * Create an info embed with consistent styling
 */
export function createInfoEmbed(title: string, description?: string): EmbedBuilder {
  const embed = new EmbedBuilder().setTitle(title).setColor(DISCORD_COLORS.BLURPLE).setTimestamp();

  if (description !== undefined) {
    embed.setDescription(description);
  }

  return embed;
}

/**
 * Create an error embed with consistent styling
 */
export function createErrorEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(DISCORD_COLORS.ERROR)
    .setDescription(description)
    .setTimestamp();
}

/**
 * Create a warning embed with consistent styling
 */
export function createWarningEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(DISCORD_COLORS.WARNING)
    .setDescription(description)
    .setTimestamp();
}

/**
 * Create a danger embed for destructive action confirmations
 * Uses ERROR color (red) to clearly indicate high-risk operations
 */
// eslint-disable-next-line sonarjs/no-identical-functions -- createErrorEmbed and createDangerEmbed share implementation but differ in semantic intent (warning vs destructive action)
export function createDangerEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setColor(DISCORD_COLORS.ERROR)
    .setDescription(description)
    .setTimestamp();
}
