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

import {
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type StringSelectMenuInteraction,
  type ButtonInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { defineCommand } from '../../utils/defineCommand.js';
import { createSubcommandContextRouter } from '../../utils/subcommandContextRouter.js';
import type {
  SafeCommandContext,
  DeferredCommandContext,
} from '../../utils/commandContext/types.js';
import { requireBotOwnerContext } from '../../utils/commandContext/index.js';

// Import subcommand handlers
import { handlePing } from './ping.js';
import { handleDbSync, handleDbSyncDetailsButton, isDbSyncDetailsButton } from './db-sync.js';
import {
  handleServers,
  handleServersBrowsePagination,
  handleServersSelect,
  isServersBrowsePagination,
  isServersBrowseSelect,
} from './servers.js';
import { handleKick } from './kick.js';
import { handleUsage } from './usage.js';
import { handleBroadcast } from './broadcast.js';
import { handleCleanup } from './cleanup.js';
import { handleHealth } from './health.js';
import { handleMetrics } from './metrics.js';
import { handlePresence } from './presence.js';
import {
  handleSettings,
  handleAdminSettingsSelectMenu,
  handleAdminSettingsButton,
  handleAdminSettingsModal,
  isAdminSettingsInteraction,
} from './settings.js';
import {
  handleSettingsSet,
  handleSettingNameAutocomplete,
  handleSettingValueAutocomplete,
} from './settingsSet.js';

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
    broadcast: handleBroadcast,
    cleanup: handleCleanup,
    health: handleHealth,
    metrics: handleMetrics,
    presence: handlePresence,
  },
  { logger, logPrefix: '[Admin]' }
);

/**
 * Router for the `settings` subcommand GROUP: `edit` opens the dashboard
 * (the pre-group `/admin settings` behavior), `set` is the direct setter.
 */
const settingsGroupRouter = createSubcommandContextRouter(
  {
    edit: handleSettings,
    set: handleSettingsSet,
  },
  { logger, logPrefix: '[Admin/Settings]' }
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

  if (context.getSubcommandGroup() === 'settings') {
    await settingsGroupRouter(context);
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
    } else if (focusedOption.name === 'setting') {
      await handleSettingNameAutocomplete(interaction, focusedOption.value);
    } else if (focusedOption.name === 'value') {
      await handleSettingValueAutocomplete(interaction, focusedOption.value);
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
      'Autocomplete error'
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
  // Servers browse select — narrowly matches the browse-select prefix.
  if (isServersBrowseSelect(interaction.customId)) {
    // Note: Owner check - interaction is on admin command which requires owner
    await handleServersSelect(interaction);
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

  // db-sync "Show details" reveal — narrowly matches its prefix.
  if (isDbSyncDetailsButton(customId)) {
    // Owner check: the button only exists on the owner-gated db-sync reply.
    await handleDbSyncDetailsButton(interaction);
    return;
  }

  // Servers browse pagination — narrowly matches the browse prefix.
  // After the Session 5 Part B migration, the "Back to List" button on
  // the server details view also uses this browse customId shape, so
  // this single guard catches both regular pagination clicks and
  // back-button clicks.
  if (isServersBrowsePagination(customId)) {
    await handleServersBrowsePagination(interaction);
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
        .addBooleanOption(option =>
          option
            .setName('allow-schema-skew')
            .setDescription('Proceed despite a migration-soak version mismatch (skew is logged)')
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
        .setName('broadcast')
        .setDescription('DM every opted-in user through the release-notes pipeline')
        .addStringOption(option =>
          option
            .setName('message')
            .setDescription('The DM body (opt-out footer is appended automatically)')
            .setRequired(true)
            .setMaxLength(1800)
        )
        .addStringOption(option =>
          option
            .setName('level')
            .setDescription('Message importance — major reaches everyone opted in (default)')
            .setRequired(false)
            .addChoices(
              { name: 'Major — everyone opted in', value: 'major' },
              { name: 'Minor — users at minor or patch threshold', value: 'minor' },
              { name: 'Patch — only users opted into everything', value: 'patch' }
            )
        )
        .addStringOption(option =>
          option
            .setName('label')
            .setDescription('Unique version label (default: timestamped adhoc-…)')
            .setRequired(false)
            .setMaxLength(50)
        )
        .addBooleanOption(option =>
          option
            .setName('dry-run')
            .setDescription('Preview the audience without sending (default: false)')
            .setRequired(false)
        )
        .addBooleanOption(option =>
          option
            .setName('confirm')
            .setDescription('Required true for a REAL send (no undo)')
            .setRequired(false)
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
    .addSubcommandGroup(group =>
      group
        .setName('settings')
        .setDescription('Global settings (dashboard + direct setter)')
        .addSubcommand(subcommand =>
          subcommand.setName('edit').setDescription('Open global settings dashboard')
        )
        .addSubcommand(subcommand =>
          subcommand
            .setName('set')
            .setDescription('Set a system setting directly')
            .addStringOption(option =>
              option
                .setName('setting')
                .setDescription('Which setting to change')
                .setRequired(true)
                .setAutocomplete(true)
            )
            .addStringOption(option =>
              option
                .setName('value')
                .setDescription('The new value (validated against the model catalogs)')
                .setRequired(true)
                .setAutocomplete(true)
            )
        )
    )
    .addSubcommand(subcommand =>
      subcommand.setName('health').setDescription('Check bot health and connected services')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('metrics')
        .setDescription('View gateway queue depth, dedup cache size, and uptime')
    )
    .addSubcommand(subcommand =>
      subcommand
        .setName('presence')
        .setDescription('Set or view the bot presence (activity status)')
        .addIntegerOption(option =>
          option
            .setName('type')
            .setDescription('Activity type')
            .setRequired(false)
            .addChoices(
              { name: 'Custom Status', value: 4 },
              { name: 'Playing', value: 0 },
              { name: 'Listening to', value: 2 },
              { name: 'Watching', value: 3 },
              { name: 'Competing in', value: 5 },
              { name: 'None (clear)', value: 99 }
            )
        )
        .addStringOption(option =>
          option
            .setName('text')
            .setDescription('Activity text (e.g., "with fire")')
            .setRequired(false)
        )
    ),
  deferralMode: 'ephemeral',
  execute,
  autocomplete,
  handleSelectMenu,
  handleButton,
  handleModal,
  componentPrefixes: ['admin-settings', 'admin-servers', 'admin-dbsync'],
});
