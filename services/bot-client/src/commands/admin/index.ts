/**
 * Admin Command Group
 * Groups all admin commands under /admin with subcommands
 * Owner-only commands for bot administration
 *
 * This file is the main entry point - it exports the command definition
 * and routes execution to the appropriate handler.
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, getConfig, requireBotOwner, type EnvConfig } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';

// Import subcommand handlers
import { handleDbSync } from './db-sync.js';
import { handleServers } from './servers.js';
import { handleKick } from './kick.js';
import { handleUsage } from './usage.js';

const logger = createLogger('admin-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('admin')
  .setDescription('Admin commands (Owner only)')
  .addSubcommand(subcommand =>
    subcommand
      .setName('db-sync')
      .setDescription('Trigger bidirectional database synchronization')
      .addBooleanOption(option =>
        option
          .setName('dry-run')
          .setDescription('Preview changes without applying them')
          .setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand.setName('servers').setDescription('List all servers the bot is in')
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('kick')
      .setDescription('Remove the bot from a server')
      .addStringOption(option =>
        option.setName('server-id').setDescription('Discord server ID to leave').setRequired(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('usage')
      .setDescription('View API usage statistics')
      .addStringOption(option =>
        option
          .setName('period')
          .setDescription('Time period for stats')
          .setRequired(false)
          .addChoices(
            { name: 'Last 24 hours', value: '24h' },
            { name: 'Last 7 days', value: '7d' },
            { name: 'Last 30 days', value: '30d' }
          )
      )
  );

/**
 * Create admin router with config dependency
 */
function createAdminRouter(
  config: EnvConfig
): (interaction: ChatInputCommandInteraction) => Promise<void> {
  return createSubcommandRouter(
    {
      'db-sync': interaction => handleDbSync(interaction, config),
      servers: handleServers,
      kick: handleKick,
      usage: interaction => handleUsage(interaction, config),
    },
    { logger, logPrefix: '[Admin]' }
  );
}

/**
 * Command execution router
 * Routes to the appropriate subcommand handler
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Owner-only check
  if (!(await requireBotOwner(interaction))) {
    return;
  }

  const config = getConfig();
  const router = createAdminRouter(config);
  await router(interaction);
}
