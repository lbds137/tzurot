/**
 * Admin Command Group
 * Groups all admin commands under /admin with subcommands
 * Owner-only commands for bot administration
 *
 * This file is the main entry point - it exports the command definition
 * and routes execution to the appropriate handler.
 */

import { SlashCommandBuilder } from 'discord.js';
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import { createLogger, requireBotOwner, DISCORD_LIMITS } from '@tzurot/common-types';
import { createSubcommandRouter } from '../../utils/subcommandRouter.js';
import { adminFetch } from '../../utils/adminApiClient.js';

// Import subcommand handlers
import { handleDbSync } from './db-sync.js';
import { handleServers } from './servers.js';
import { handleKick } from './kick.js';
import { handleUsage } from './usage.js';
import { handleLlmConfigCreate } from './llm-config-create.js';
import { handleLlmConfigSetDefault } from './llm-config-set-default.js';
import { handleLlmConfigSetFreeDefault } from './llm-config-set-free-default.js';
import { handleLlmConfigEdit } from './llm-config-edit.js';

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
      .setName('llm-config-create')
      .setDescription('Create a new global LLM config')
      .addStringOption(option =>
        option.setName('name').setDescription('Config name').setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('model')
          .setDescription('Model ID (e.g., anthropic/claude-sonnet-4)')
          .setRequired(true)
      )
      .addStringOption(option =>
        option
          .setName('provider')
          .setDescription('AI provider')
          .setRequired(false)
          .addChoices(
            { name: 'OpenRouter', value: 'openrouter' },
            { name: 'Anthropic', value: 'anthropic' },
            { name: 'OpenAI', value: 'openai' },
            { name: 'Google', value: 'google' }
          )
      )
      .addStringOption(option =>
        option.setName('description').setDescription('Optional description').setRequired(false)
      )
      .addStringOption(option =>
        option.setName('vision-model').setDescription('Vision model (optional)').setRequired(false)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('llm-config-set-default')
      .setDescription('Set a global config as the system default')
      .addStringOption(option =>
        option
          .setName('config')
          .setDescription('Global config to set as default')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('llm-config-set-free-default')
      .setDescription('Set a global config as the free tier default for guest users')
      .addStringOption(option =>
        option
          .setName('config')
          .setDescription('Global config to set as free tier default')
          .setRequired(true)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('llm-config-edit')
      .setDescription('Edit an existing global LLM config')
      .addStringOption(option =>
        option
          .setName('config')
          .setDescription('Global config to edit')
          .setRequired(true)
          .setAutocomplete(true)
      )
      .addStringOption(option =>
        option.setName('name').setDescription('New config name').setRequired(false)
      )
      .addStringOption(option =>
        option.setName('model').setDescription('New model ID').setRequired(false)
      )
      .addStringOption(option =>
        option
          .setName('provider')
          .setDescription('New AI provider')
          .setRequired(false)
          .addChoices(
            { name: 'OpenRouter', value: 'openrouter' },
            { name: 'Anthropic', value: 'anthropic' },
            { name: 'OpenAI', value: 'openai' },
            { name: 'Google', value: 'google' }
          )
      )
      .addStringOption(option =>
        option.setName('description').setDescription('New description').setRequired(false)
      )
      .addStringOption(option =>
        option.setName('vision-model').setDescription('New vision model').setRequired(false)
      )
  );

/**
 * Create admin router with config dependency
 */
function createAdminRouter(): (interaction: ChatInputCommandInteraction) => Promise<void> {
  return createSubcommandRouter(
    {
      'db-sync': handleDbSync,
      servers: handleServers,
      kick: handleKick,
      usage: handleUsage,
      'llm-config-create': handleLlmConfigCreate,
      'llm-config-set-default': handleLlmConfigSetDefault,
      'llm-config-set-free-default': handleLlmConfigSetFreeDefault,
      'llm-config-edit': handleLlmConfigEdit,
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
    if (focusedOption.name === 'config') {
      // Autocomplete for llm-config-set-default
      await handleConfigAutocomplete(interaction, focusedOption.value);
    } else if (focusedOption.name === 'server-id') {
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
 * Autocomplete for global LLM configs
 */
async function handleConfigAutocomplete(
  interaction: AutocompleteInteraction,
  query: string
): Promise<void> {
  try {
    const response = await adminFetch('/admin/llm-config');

    if (!response.ok) {
      await interaction.respond([]);
      return;
    }

    const data = (await response.json()) as {
      configs: {
        id: string;
        name: string;
        model: string;
        isGlobal: boolean;
        isDefault: boolean;
        isFreeDefault?: boolean;
      }[];
    };

    const queryLower = query.toLowerCase();
    const filtered = data.configs
      .filter(
        c =>
          c.isGlobal &&
          (c.name.toLowerCase().includes(queryLower) || c.model.toLowerCase().includes(queryLower))
      )
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES);

    const choices = filtered.map(c => {
      let suffix = '';
      if (c.isDefault === true) {
        suffix += ' [DEFAULT]';
      }
      if (c.isFreeDefault === true) {
        suffix += ' [FREE]';
      }
      return {
        name: `${c.name} (${c.model.split('/').pop()})${suffix}`,
        value: c.id,
      };
    });

    await interaction.respond(choices);
  } catch {
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
