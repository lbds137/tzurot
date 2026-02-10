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
import type {
  AutocompleteInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger, DISCORD_LIMITS } from '@tzurot/common-types';
import { defineCommand } from '../../utils/defineCommand.js';
import { createSubcommandContextRouter } from '../../utils/subcommandContextRouter.js';
import type {
  SafeCommandContext,
  DeferredCommandContext,
} from '../../utils/commandContext/types.js';
import { requireBotOwnerContext } from '../../utils/commandContext/index.js';

// Import subcommand handlers
import { handlePing } from './ping.js';
import { handleDbSync } from './db-sync.js';
import {
  handleServers,
  handleServersBrowsePagination,
  handleServersSelect,
  handleServersBack,
  isServersBrowseInteraction,
  parseBrowseCustomId,
  parseBackCustomId,
} from './servers.js';
import { handleKick } from './kick.js';
import { handleUsage } from './usage.js';
import { handleCleanup } from './cleanup.js';
import {
  handleDebug,
  handleDebugButton,
  handleDebugSelectMenu,
  isDebugInteraction,
} from './debug/index.js';
import {
  handleBrowsePagination as handleDebugBrowsePagination,
  handleBrowseLogSelection as handleDebugBrowseLogSelection,
  isDebugBrowseInteraction,
  isDebugBrowseSelectInteraction,
} from './debug/browse.js';
import {
  handleSettings,
  handleAdminSettingsSelectMenu,
  handleAdminSettingsButton,
  handleAdminSettingsModal,
  isAdminSettingsInteraction,
} from './settings.js';

const logger = createLogger('admin-command');

/**
 * Create admin router for context-based commands.
 * Uses createSubcommandContextRouter for type-safe routing with DeferredCommandContext.
 */
const adminRouter = createSubcommandContextRouter(
  {
    ping: handlePing,
    'db-sync': handleDbSync,
    servers: handleServers,
    kick: handleKick,
    usage: handleUsage,
    cleanup: handleCleanup,
    debug: handleDebug,
    settings: handleSettings,
  },
  { logger, logPrefix: '[Admin]' }
);

/**
 * Command execution router
 * Routes to the appropriate subcommand handler
 *
 * Receives SafeCommandContext (specifically DeferredCommandContext since
 * deferralMode: 'ephemeral') - the framework has already deferred the reply.
 */
async function execute(ctx: SafeCommandContext): Promise<void> {
  const context = ctx as DeferredCommandContext;

  // Owner-only check (uses editReply since already deferred)
  if (!(await requireBotOwnerContext(context))) {
    return;
  }

  await adminRouter(context);
}

/**
 * Autocomplete handler for admin commands
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
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

/**
 * Handle select menu interactions for admin commands
 */
async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  // Servers browse select
  if (isServersBrowseInteraction(interaction.customId)) {
    // Note: Owner check - interaction is on admin command which requires owner
    await handleServersSelect(interaction);
    return;
  }

  // Debug browse select (must check before general debug interaction)
  if (isDebugBrowseSelectInteraction(interaction.customId)) {
    await handleDebugBrowseLogSelection(interaction);
    return;
  }

  // Debug interactive views
  if (isDebugInteraction(interaction.customId)) {
    await handleDebugSelectMenu(interaction);
    return;
  }

  // Settings dashboard interactions
  if (isAdminSettingsInteraction(interaction.customId)) {
    // Note: Owner check is done via session ownership (dashboard is only created for owner)
    await handleAdminSettingsSelectMenu(interaction);
  }
}

/**
 * Handle button interactions for admin commands
 */
async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  // Servers browse pagination
  if (parseBrowseCustomId(customId) !== null) {
    await handleServersBrowsePagination(interaction);
    return;
  }

  // Servers back button
  if (parseBackCustomId(customId) !== null) {
    await handleServersBack(interaction);
    return;
  }

  // Debug browse pagination (must check before general debug interaction)
  if (isDebugBrowseInteraction(customId)) {
    await handleDebugBrowsePagination(interaction);
    return;
  }

  // Debug interactive views
  if (isDebugInteraction(customId)) {
    await handleDebugButton(interaction);
    return;
  }

  // Settings dashboard interactions
  if (isAdminSettingsInteraction(customId)) {
    // Note: Owner check is done via session ownership (dashboard is only created for owner)
    await handleAdminSettingsButton(interaction);
  }
}

/**
 * Handle modal submissions for admin commands
 */
async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  // Settings dashboard interactions
  if (isAdminSettingsInteraction(interaction.customId)) {
    // Note: Owner check is done via session ownership (dashboard is only created for owner)
    await handleAdminSettingsModal(interaction);
  }
}

/**
 * Export command definition using defineCommand for type safety
 * Category is injected by CommandHandler based on folder structure
 */
export default defineCommand({
  data: new SlashCommandBuilder()
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
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('cleanup')
        .setDescription('Clean up old conversation history and tombstones')
        .addIntegerOption(option =>
          option
            .setName('days')
            .setDescription('Keep history from the last N days (default: 30)')
            .setRequired(false)
            .setMinValue(1)
            .setMaxValue(365)
        )
        .addStringOption(option =>
          option
            .setName('target')
            .setDescription('What to clean up (default: all)')
            .setRequired(false)
            .addChoices(
              { name: 'All (history + tombstones)', value: 'all' },
              { name: 'History only', value: 'history' },
              { name: 'Tombstones only', value: 'tombstones' }
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('settings').setDescription('Open global settings dashboard')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('debug')
        .setDescription('Retrieve LLM diagnostic log for debugging')
        .addStringOption(option =>
          option
            .setName('identifier')
            .setDescription('Message ID, message link, or request UUID (omit to browse recent)')
            .setRequired(false)
        )
    ),
  deferralMode: 'ephemeral',
  execute,
  autocomplete,
  handleSelectMenu,
  handleButton,
  handleModal,
  componentPrefixes: ['admin-settings', 'admin-servers', 'admin-debug'],
});
