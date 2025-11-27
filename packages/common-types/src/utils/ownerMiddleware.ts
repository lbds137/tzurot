/**
 * Owner Middleware
 *
 * Centralized bot owner verification for owner-only commands.
 * Used by admin and personality management commands.
 */

import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { MessageFlags } from 'discord-api-types/v10';
import { getConfig } from '../config/index.js';

/**
 * Check if a Discord ID matches the configured bot owner
 *
 * Used for:
 * - Auto-promoting bot owner to superuser on first interaction
 * - BYOK wallet owner checks
 *
 * @param discordId - Discord user ID to check
 * @returns true if the ID matches BOT_OWNER_ID config
 */
export function isBotOwner(discordId: string): boolean {
  const config = getConfig();
  return config.BOT_OWNER_ID !== undefined && config.BOT_OWNER_ID === discordId;
}

/**
 * Verify that the interaction user is the bot owner
 *
 * Replies with error message if verification fails.
 *
 * @param interaction - Discord command or modal interaction
 * @returns true if user is owner, false otherwise
 */
export async function requireBotOwner(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction
): Promise<boolean> {
  const config = getConfig();
  const ownerId = config.BOT_OWNER_ID;

  // Check if owner ID is configured
  if (ownerId === undefined || ownerId === null || ownerId.length === 0) {
    await interaction.reply({
      content: '⚠️ Bot owner not configured. Please set BOT_OWNER_ID environment variable.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  // Check if user is the owner
  if (interaction.user.id !== ownerId) {
    await interaction.reply({
      content: '❌ Owner-only command. This command is restricted to the bot owner.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  return true;
}
