/**
 * Command Helpers
 * Shared utilities for Discord slash command handlers
 *
 * Provides:
 * - Consistent ephemeral reply patterns
 * - Standardized error handling
 * - Common interaction utilities
 */

import { MessageFlags, EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS } from '@tzurot/common-types';
import { isGatewayConfigured } from './userGatewayClient.js';

const logger = createLogger('command-helpers');

/**
 * Defer reply as ephemeral (only visible to the user)
 * Most BYOK commands use this pattern
 */
export async function deferEphemeral(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

/**
 * Reply with a simple error message
 */
export async function replyWithError(
  interaction: ChatInputCommandInteraction,
  message: string
): Promise<void> {
  await interaction.editReply({ content: `❌ ${message}` });
}

/**
 * Reply with a configuration error (gateway not configured)
 */
export async function replyConfigError(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.editReply({
    content: '❌ Service configuration error. Please try again later.',
  });
}

/**
 * Check if gateway is configured, reply with error if not
 * Returns true if configured, false if error was sent
 */
export async function ensureGatewayConfigured(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  if (!isGatewayConfigured()) {
    await replyConfigError(interaction);
    return false;
  }
  return true;
}

/**
 * Handle a generic command error (catch block)
 */
export async function handleCommandError(
  interaction: ChatInputCommandInteraction,
  error: unknown,
  context: { userId: string; command: string }
): Promise<void> {
  logger.error({ err: error, ...context }, `[${context.command}] Error`);
  await interaction.editReply({
    content: '❌ An error occurred. Please try again later.',
  });
}

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
