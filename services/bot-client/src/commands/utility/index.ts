/**
 * Utility Command Group
 * Groups utility commands under /utility with subcommands
 *
 * This file is the main entry point - it exports the command definition
 * and routes execution to the appropriate handler.
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { Command } from '../../types.js';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';

// Import subcommand handlers
import { handlePing } from './ping.js';
import { handleHelp } from './help.js';

const logger = createLogger('utility-command');

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
 * Create a router with access to commands map for help subcommand
 */
function createUtilityRouter(commands?: Map<string, Command>): (interaction: ChatInputCommandInteraction) => Promise<void> {
  return createSubcommandRouter(
    {
      ping: handlePing,
      help: interaction => handleHelp(interaction, commands),
    },
    { logger, logPrefix: '[Utility]' }
  );
}

/**
 * Command execution router
 * Routes to the appropriate subcommand handler
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  commands?: Map<string, Command>
): Promise<void> {
  const router = createUtilityRouter(commands);
  await router(interaction);
}
