/**
 * Admin Command Group
 * Groups all admin commands under /admin with subcommands
 * Owner-only commands for bot administration
 *
 * This file is the main entry point - it exports the command definition
 * and routes execution to the appropriate handler.
 *
 * Note: LLM config management has been moved to /preset global commands
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { createLogger, requireBotOwner, DISCORD_LIMITS } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';

// Import subcommand handlers
import { handlePing } from './ping.js';
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
    subcommand.setName('ping').setDescription('Check bot responsiveness and latency')
  )
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
        option
          .setName('server-id')
          .setDescription('Discord server to leave')
          .setRequired(true)
          .setAutocomplete(true)
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
function createAdminRouter(): (interaction: ChatInputCommandInteraction) => Promise<void> {
  return createSubcommandRouter(
    {
      ping: handlePing,
      'db-sync': handleDbSync,
      servers: handleServers,
      kick: handleKick,
      usage: handleUsage,
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

  const router = createAdminRouter();
  await router(interaction);
}

/**
 * Autocomplete handler for admin commands
 */
export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focusedOption = interaction.options.getFocused(true);

  try {
    if (focusedOption.name === 'server-id') {
      // Autocomplete for kick command
      await handleServerAutocomplete(interaction, focusedOption.value);
    } else {
      await interaction.respond([]);
    }
  } catch (error) {
    logger.error(
      {
        err: error,
        option: focusedOption.name,
        query: focusedOption.value,
        userId: interaction.user.id,
        guildId: interaction.guildId,
        command: interaction.commandName,
        subcommand: interaction.options.getSubcommand(false),
      },
      '[Admin] Autocomplete error'
    );
    await interaction.respond([]);
  }
}

/**
 * Autocomplete for servers the bot is in
 */
async function handleServerAutocomplete(
  interaction: AutocompleteInteraction,
  query: string
): Promise<void> {
  const client = interaction.client;
  const queryLower = query.toLowerCase();

  const servers = client.guilds.cache
    .filter(guild => guild.name.toLowerCase().includes(queryLower) || guild.id.includes(query))
    .map(guild => ({
      name: `${guild.name} (${guild.memberCount} members)`,
      value: guild.id,
    }))
    .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

  await interaction.respond(servers);
}
