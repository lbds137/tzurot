/**
 * Deny Command Group
 *
 * Manage user and server denials with three-tier permissions:
 * - Bot owner: all scopes (BOT, GUILD, CHANNEL, PERSONALITY)
 * - Server mods (Manage Messages): GUILD and CHANNEL scope within their guild
 * - Character creators: PERSONALITY scope for characters they own
 *
 * Subcommands:
 * - /deny add {everywhere|this-server|channel|character} — Add a denial entry
 * - /deny remove {everywhere|this-server|channel|character} — Remove a denial entry
 * - /deny browse — Browse denial entries with pagination (owner only)
 * - /deny view — Look up denylist entries by Discord ID (owner only)
 *
 * `add` and `remove` are subcommand GROUPS so the scope is picked by name and
 * only the options legal for that scope appear; `browse` and `view` stay flat.
 */

import {
  ChannelType,
  SlashCommandBuilder,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type SlashCommandSubcommandBuilder,
  type SlashCommandSubcommandGroupBuilder,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
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
// Ensure the deny browse rebuilder is registered on module load, even when
// subcommands that don't touch detail.ts fire first.
import './browseRebuilder.js';

const logger = createLogger('deny-command');

/** Flat subcommands only — `add` and `remove` are groups, routed by group name below. */
const denyRouter = createSubcommandContextRouter(
  {
    browse: handleBrowse,
    view: handleView,
  },
  { logger, logPrefix: '[Deny]' }
);

async function execute(ctx: SafeCommandContext): Promise<void> {
  const context = ctx as DeferredCommandContext;
  const group = context.getSubcommandGroup();

  // Both groups carry the same four scope subcommands, so a flat router keyed
  // on subcommand name alone would collide; each group has one handler that
  // derives the scope from the subcommand name.
  if (group === 'add') {
    await handleAdd(context);
    return;
  }
  if (group === 'remove') {
    await handleRemove(context);
    return;
  }

  await denyRouter(context);
}

async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name === 'character') {
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

const USER_OPTION_DESCRIPTION = 'The user to deny';

/** `reason` + `mode` are add-only; removing a denial takes neither. */
function withAddOnlyOptions(
  sub: SlashCommandSubcommandBuilder,
  isAdd: boolean
): SlashCommandSubcommandBuilder {
  if (!isAdd) {
    return sub;
  }
  return sub
    .addStringOption(opt =>
      opt.setName('reason').setDescription('Reason for the denial').setRequired(false)
    )
    .addStringOption(opt =>
      opt
        .setName('mode')
        .setDescription('Denial mode (default: Block)')
        .setRequired(false)
        .addChoices(...MODE_CHOICES)
    );
}

function buildEverywhere(
  sub: SlashCommandSubcommandBuilder,
  isAdd: boolean
): SlashCommandSubcommandBuilder {
  // The only subcommand exposing `server:` — a server denial is bot-wide by
  // definition, so the narrower scopes cannot offer the option at all.
  sub
    .setName('everywhere')
    .setDescription(
      isAdd ? 'Deny in every server and DM (owner only)' : 'Remove a bot-wide denial (owner only)'
    )
    .addUserOption(opt =>
      opt.setName('user').setDescription(USER_OPTION_DESCRIPTION).setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('server').setDescription('Server ID to deny instead of a user').setRequired(false)
    );
  return withAddOnlyOptions(sub, isAdd);
}

function buildThisServer(
  sub: SlashCommandSubcommandBuilder,
  isAdd: boolean
): SlashCommandSubcommandBuilder {
  sub
    .setName('this-server')
    .setDescription(isAdd ? 'Deny throughout this server' : 'Remove a denial for this server')
    .addUserOption(opt =>
      opt.setName('user').setDescription(USER_OPTION_DESCRIPTION).setRequired(true)
    );
  return withAddOnlyOptions(sub, isAdd);
}

function buildChannel(
  sub: SlashCommandSubcommandBuilder,
  isAdd: boolean
): SlashCommandSubcommandBuilder {
  sub
    .setName('channel')
    .setDescription(isAdd ? 'Deny in one channel' : 'Remove a denial for one channel')
    .addUserOption(opt =>
      opt.setName('user').setDescription(USER_OPTION_DESCRIPTION).setRequired(true)
    )
    .addChannelOption(opt =>
      opt
        .setName('channel')
        .setDescription('The channel the denial applies to')
        .setRequired(true)
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildForum)
    );
  return withAddOnlyOptions(sub, isAdd);
}

function buildCharacter(
  sub: SlashCommandSubcommandBuilder,
  isAdd: boolean
): SlashCommandSubcommandBuilder {
  sub
    .setName('character')
    .setDescription(isAdd ? 'Deny for one character' : 'Remove a denial for one character')
    .addUserOption(opt =>
      opt.setName('user').setDescription(USER_OPTION_DESCRIPTION).setRequired(true)
    )
    .addStringOption(opt =>
      opt
        .setName('character')
        .setDescription('The character the denial applies to')
        .setRequired(true)
        .setAutocomplete(true)
    );
  return withAddOnlyOptions(sub, isAdd);
}

/** Scope-first group: the subcommand name IS the denial scope. */
function buildScopeGroup(
  group: SlashCommandSubcommandGroupBuilder,
  isAdd: boolean
): SlashCommandSubcommandGroupBuilder {
  return group
    .setName(isAdd ? 'add' : 'remove')
    .setDescription(isAdd ? 'Deny a user or server' : 'Remove a denial')
    .addSubcommand(sub => buildEverywhere(sub, isAdd))
    .addSubcommand(sub => buildThisServer(sub, isAdd))
    .addSubcommand(sub => buildChannel(sub, isAdd))
    .addSubcommand(sub => buildCharacter(sub, isAdd));
}

export default defineCommand({
  deferralMode: 'ephemeral',
  data: new SlashCommandBuilder()
    .setName('deny')
    .setDescription('Manage user and server denials')
    // Hide from non-admin members' command pickers. The owner runtime gates
    // stay authoritative — this is picker hygiene, not access control.
    .setDefaultMemberPermissions('0')
    .addSubcommandGroup(group => buildScopeGroup(group, true))
    .addSubcommandGroup(group => buildScopeGroup(group, false))
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
