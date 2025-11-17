/**
 * Owner Middleware
 *
 * Centralized bot owner verification for owner-only commands.
 * Used by admin and personality management commands.
 */

import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import { MessageFlags } from 'discord.js';
import { getConfig } from '../config/index.js';

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

  // Owner-only check
  if (
    ownerId === undefined ||
    ownerId === null ||
    ownerId.length === 0 ||
    interaction.user.id !== ownerId
  ) {
    await interaction.reply({
      content: '❌ This command is only available to the bot owner.',
      flags: MessageFlags.Ephemeral,
    });
    return false;
  }

  return true;
}
