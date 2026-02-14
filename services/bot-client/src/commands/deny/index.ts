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
 * - /deny list — List all denial entries (owner only)
 */

import { ChannelType, SlashCommandBuilder } from 'discord.js';
import type { AutocompleteInteraction } from 'discord.js';
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
import { handleList } from './list.js';

const logger = createLogger('deny-command');

const denyRouter = createSubcommandContextRouter(
  {
    add: handleAdd,
    remove: handleRemove,
    list: handleList,
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
          opt.setName('target').setDescription('Discord user or server ID').setRequired(true)
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
    )
    .addSubcommand(sub =>
      sub
        .setName('remove')
        .setDescription('Remove a denial')
        .addStringOption(opt =>
          opt.setName('target').setDescription('Discord user or server ID').setRequired(true)
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
        .setName('list')
        .setDescription('List all denial entries (owner only)')
        .addStringOption(opt =>
          opt
            .setName('type')
            .setDescription('Filter by entity type')
            .setRequired(false)
            .addChoices(...TYPE_CHOICES)
        )
    ),
  execute,
  autocomplete,
});
