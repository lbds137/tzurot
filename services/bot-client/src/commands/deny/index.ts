/**
 * Deny Command Group
 *
 * Manage user and server denials with three-tier permissions:
 * - Bot owner: all scopes (BOT, GUILD, CHANNEL, PERSONALITY)
 * - Server mods (Manage Messages): GUILD and CHANNEL scope within their guild
 * - Character creators: PERSONALITY scope for characters they own
 *
 * Subcommands:
 * - /deny add — Add a denial entry
 * - /deny remove — Remove a denial entry
 * - /deny browse — Browse denial entries with pagination (owner only)
 * - /deny view — Look up denylist entries by Discord ID (owner only)
 */

import { ChannelType, SlashCommandBuilder } from 'discord.js';
import type {
  AutocompleteInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import {
  defineCommand,
  type DeferredCommandContext,
  type SafeCommandContext,
} from '../../utils/defineCommand.js';
import { createSubcommandContextRouter } from '../../utils/subcommandContextRouter.js';
import { handlePersonalityAutocomplete } from '../../utils/autocomplete/index.js';
import { handleAdd } from './add.js';
import { handleRemove } from './remove.js';
import { handleView } from './view.js';
import {
  handleBrowse,
  handleBrowsePagination,
  handleBrowseSelect,
  isDenyBrowseInteraction,
  isDenyBrowseSelectInteraction,
} from './browse.js';
import { handleDetailButton, handleDetailModal } from './detail.js';

const logger = createLogger('deny-command');

const denyRouter = createSubcommandContextRouter(
  {
    add: handleAdd,
    remove: handleRemove,
    browse: handleBrowse,
    view: handleView,
  },
  { logger, logPrefix: '[Deny]' }
);

async function execute(ctx: SafeCommandContext): Promise<void> {
  const context = ctx as DeferredCommandContext;
  await denyRouter(context);
}

async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'personality') {
    await handlePersonalityAutocomplete(interaction);
  }
}

async function handleButton(interaction: ButtonInteraction): Promise<void> {
  if (isDenyBrowseInteraction(interaction.customId)) {
    await handleBrowsePagination(interaction);
  } else {
    // Detail view buttons (deny::mode::, deny::edit::, deny::del::, etc.)
    await handleDetailButton(interaction);
  }
}

async function handleSelectMenu(interaction: StringSelectMenuInteraction): Promise<void> {
  if (isDenyBrowseSelectInteraction(interaction.customId)) {
    await handleBrowseSelect(interaction);
  }
}

async function handleModal(interaction: ModalSubmitInteraction): Promise<void> {
  await handleDetailModal(interaction);
}

const TYPE_CHOICES: { name: string; value: string }[] = [
  { name: 'User', value: 'USER' },
  { name: 'Server', value: 'GUILD' },
];

const SCOPE_CHOICES: { name: string; value: string }[] = [
  { name: 'Bot (bot-wide)', value: 'BOT' },
  { name: 'Guild (this server)', value: 'GUILD' },
  { name: 'Channel (specific channel)', value: 'CHANNEL' },
  { name: 'Personality (specific character)', value: 'PERSONALITY' },
];

const MODE_CHOICES: { name: string; value: string }[] = [
  { name: 'Block (full deny, default)', value: 'BLOCK' },
  { name: 'Mute (ignore but keep in context)', value: 'MUTE' },
];

const TARGET_DESCRIPTION = 'Discord user or server ID';

const FILTER_CHOICES: { name: string; value: string }[] = [
  { name: 'All Types', value: 'all' },
  { name: 'Users Only', value: 'user' },
  { name: 'Servers Only', value: 'guild' },
];

export default defineCommand({
  deferralMode: 'ephemeral',
  data: new SlashCommandBuilder()
    .setName('deny')
    .setDescription('Manage user and server denials')
    .addSubcommand(sub =>
      sub
        .setName('add')
        .setDescription('Deny a user or server')
        .addStringOption(opt =>
          opt.setName('target').setDescription(TARGET_DESCRIPTION).setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('type')
            .setDescription('Entity type (default: User)')
            .setRequired(false)
            .addChoices(...TYPE_CHOICES)
        )
        .addStringOption(opt =>
          opt
            .setName('scope')
            .setDescription('Denial scope (default: Bot)')
            .setRequired(false)
            .addChoices(...SCOPE_CHOICES)
        )
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Target channel (for Channel scope)')
            .setRequired(false)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildForum)
        )
        .addStringOption(opt =>
          opt
            .setName('personality')
            .setDescription('Target character name (for Personality scope)')
            .setRequired(false)
            .setAutocomplete(true)
        )
        .addStringOption(opt =>
          opt.setName('reason').setDescription('Reason for the denial').setRequired(false)
        )
        .addStringOption(opt =>
          opt
            .setName('mode')
            .setDescription('Denial mode (default: Block)')
            .setRequired(false)
            .addChoices(...MODE_CHOICES)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a denial')
        .addStringOption(opt =>
          opt.setName('target').setDescription(TARGET_DESCRIPTION).setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('type')
            .setDescription('Entity type (default: User)')
            .setRequired(false)
            .addChoices(...TYPE_CHOICES)
        )
        .addStringOption(opt =>
          opt
            .setName('scope')
            .setDescription('Denial scope (default: Bot)')
            .setRequired(false)
            .addChoices(...SCOPE_CHOICES)
        )
        .addChannelOption(opt =>
          opt
            .setName('channel')
            .setDescription('Target channel (for Channel scope)')
            .setRequired(false)
            .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildForum)
        )
        .addStringOption(opt =>
          opt
            .setName('personality')
            .setDescription('Target character name (for Personality scope)')
            .setRequired(false)
            .setAutocomplete(true)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('browse')
        .setDescription('Browse denial entries (owner only)')
        .addStringOption(opt =>
          opt
            .setName('filter')
            .setDescription('Filter by entity type')
            .setRequired(false)
            .addChoices(...FILTER_CHOICES)
        )
    )
    .addSubcommand(sub =>
      sub
        .setName('view')
        .setDescription('Look up denial entries by Discord ID (owner only)')
        .addStringOption(opt =>
          opt.setName('target').setDescription(TARGET_DESCRIPTION).setRequired(true)
        )
        .addStringOption(opt =>
          opt
            .setName('type')
            .setDescription('Entity type filter')
            .setRequired(false)
            .addChoices(...TYPE_CHOICES)
        )
    ),
  execute,
  autocomplete,
  handleButton,
  handleSelectMenu,
  handleModal,
});
