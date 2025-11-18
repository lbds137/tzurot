/**
 * Utility Command Group
 * Groups utility commands under /utility with subcommands
 *
 * This file is the main entry point - it exports the command definition
 * and routes execution to the appropriate handler.
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import type { Command } from '../../types.js';

// Import subcommand handlers
import { handlePing } from './ping.js';
import { handleHelp } from './help.js';

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('utility')
  .setDescription('Utility commands')
  .addSubcommand(subcommand =>
    subcommand.setName('ping').setDescription('Check if bot is responding')
  )
  .addSubcommand(subcommand =>
    subcommand.setName('help').setDescription('Show all available commands')
  );

/**
 * Command execution router
 * Routes to the appropriate subcommand handler
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  commands?: Map<string, Command>
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'ping':
      await handlePing(interaction);
      break;
    case 'help':
      await handleHelp(interaction, commands);
      break;
    default:
      await interaction.reply({
        content: '❌ Unknown subcommand',
        ephemeral: true,
      });
  }
}
