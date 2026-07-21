/**
 * Help Command
 * Top-level /help command for discoverability
 *
 * Shows all available commands grouped by category
 *
 * This command uses deferralMode: 'ephemeral' which means:
 * - The framework calls deferReply({ ephemeral: true }) before execute()
 * - The execute function receives a DeferredCommandContext (no deferReply method!)
 * - TypeScript prevents accidental deferReply() calls at compile time
 */

import { SlashCommandBuilder, EmbedBuilder, type AutocompleteInteraction } from 'discord.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';
import { getConfig } from '@tzurot/common-types/config/config';
import { DISCORD_COLORS, DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { ENTITY_EMOJI } from '@tzurot/common-types/constants/uxVocabulary';
import { helpCommandsOptions } from '@tzurot/common-types/generated/commandOptions';
import { createLogger } from '@tzurot/common-types/utils/logger';
import {
  defineCommand,
  type DeferredCommandContext,
  type SafeCommandContext,
} from '../../utils/defineCommand.js';
import type { Command } from '../../types.js';
import {
  flattenCommandLeaves,
  getCommandOptions,
  resolveHelpTarget,
  type CommandOptionNode,
} from './commandPaths.js';
// Note: Type augmentation for client.commands is in types/discord.d.ts

const logger = createLogger('help-command');

/**
 * Command category display order and emoji
 */
// Category = the command's top-level folder name (Title-cased), injected by
// CommandHandler. Every folder needs an entry here or it falls into "Other" —
// keep this in sync with services/bot-client/src/commands/*.
// Entity-backed categories use the ENTITY_EMOJI registry (§2.1 — the glyph is
// the entity's identity across every surface, help categories included).
// Non-entity categories (Settings, Inspect, Admin, …) keep bespoke glyphs;
// Settings moved off ⚙️ because that glyph is the PRESET entity's.
export const CATEGORY_CONFIG: Record<string, { emoji: string; order: number }> = {
  Character: { emoji: ENTITY_EMOJI.character, order: 1 },
  // Invoke-verb commands (/chat, /random, /chime-in) sit right behind the
  // entity they act on. Bespoke glyphs: 💬 belongs to Feedback, so Chat uses
  // the left-speech-bubble variant; 🎲 mirrors the "Picked at random" notice;
  // 🗣️ is the summon (a character speaks up).
  Chat: { emoji: '🗨️', order: 2 },
  Random: { emoji: '🎲', order: 3 },
  'Chime-in': { emoji: '🗣️', order: 4 },
  Persona: { emoji: ENTITY_EMOJI.persona, order: 5 },
  Preset: { emoji: ENTITY_EMOJI.preset, order: 6 },
  Settings: { emoji: '🛠️', order: 7 },
  Voice: { emoji: ENTITY_EMOJI.voice, order: 8 },
  Shapes: { emoji: ENTITY_EMOJI.shapes, order: 9 },
  Memory: { emoji: ENTITY_EMOJI.memory, order: 10 },
  History: { emoji: ENTITY_EMOJI.history, order: 11 },
  Channel: { emoji: ENTITY_EMOJI.channel, order: 12 },
  Inspect: { emoji: '🔍', order: 13 },
  Models: { emoji: ENTITY_EMOJI.model, order: 14 },
  Notifications: { emoji: '🔔', order: 15 },
  Feedback: { emoji: '💬', order: 16 },
  Deny: { emoji: ENTITY_EMOJI.denial, order: 17 },
  Admin: { emoji: '🛡️', order: 18 },
  Help: { emoji: '❓', order: 19 },
  Other: { emoji: '📦', order: 99 },
};

/**
 * Command execution
 *
 * Receives DeferredCommandContext (not ChatInputCommandInteraction) because
 * deferralMode is set. This context does NOT have deferReply() - any attempt
 * to call it would be a TypeScript error!
 *
 * Note: The function signature uses SafeCommandContext for TypeScript compatibility,
 * but the runtime value is always DeferredCommandContext when deferralMode is 'ephemeral'.
 */
async function execute(ctx: SafeCommandContext): Promise<void> {
  // Cast to the specific context type we expect for this deferralMode
  const context = ctx as DeferredCommandContext;
  const config = getConfig();
  const mentionChar = config.BOT_MENTION_CHAR;

  // The onboarding screen is static — it doesn't need the commands collection.
  if (context.getSubcommand() === 'getting-started') {
    await showGettingStarted(context, mentionChar);
    return;
  }

  // 'commands' — the index/detail browser.
  // Access commands via the interaction.client - attached during bot startup
  const commands = context.interaction.client.commands;

  if (commands === undefined || commands.size === 0) {
    logger.error('Commands collection not available on client');
    await context.editReply({
      content: renderSpec(CATALOG.error.transient("Couldn't load the commands list right now.")),
    });
    return;
  }

  const options = helpCommandsOptions(context.interaction);
  const specificCommand = options.command();

  if (specificCommand !== null && specificCommand !== '') {
    await showCommandDetails(context, commands, specificCommand);
  } else {
    await showAllCommands(context, commands, mentionChar);
  }
}

/**
 * The `/help getting-started` onboarding screen: what the bot is, the first
 * commands to try, and where the full guide lives. Condensed from
 * docs/guides/getting-started.md — the guide (rendered at tzurot.org) stays
 * the canonical long-form version; this embed is the in-Discord front door.
 */
async function showGettingStarted(
  context: DeferredCommandContext,
  mentionChar: string
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle('🚀 Getting Started with Tzurot')
    .setDescription(
      'Tzurot lets you talk to customizable AI characters — each with its own ' +
        'personality, voice, and long-term memory.\n\n' +
        'Tzurot is for adults: chatting with characters requires confirming you are 18 or older.'
    )
    .addFields(
      {
        name: '💬 Your first conversation',
        value:
          `• \`${mentionChar}CharacterName your message\` — talk to a character anywhere the bot can see\n` +
          '• `/character browse` — see who is available\n' +
          '• `/chat` — start a conversation via slash command (`/random` picks the character for you)',
        inline: false,
      },
      {
        name: '🎭 Make it yours',
        value:
          '• `/character create` — build your own character\n' +
          '• `/persona edit` — tell characters who *you* are',
        inline: false,
      },
      {
        name: '📚 Learn more',
        value:
          '[Full getting-started guide](https://tzurot.org/docs/getting-started) · ' +
          '[Command reference](https://tzurot.org/docs/commands)\n' +
          'Or `/help commands` for everything the bot can do.',
        inline: false,
      }
    );

  await context.editReply({ embeds: [embed] });
}

/** Discord application-command option-type discriminators. */
const OPTION_TYPE = { SUBCOMMAND: 1, SUBCOMMAND_GROUP: 2 } as const;

/** Discord's hard cap is 25 embed fields; leave one for a truncation note. */
const MAX_DETAIL_FIELDS = 24;

/** Discord's per-field value limit. */
const FIELD_VALUE_LIMIT = 1024;

/**
 * Minimal structural view of a command option as exposed by both the live
 * SlashCommandBuilder tree and the plain objects used in tests.
 */
interface RawOption {
  type?: number;
  name?: string;
  description?: string;
  required?: boolean;
  /**
   * Child options: subcommands of a group, or parameters of a subcommand —
   * the shape depends on the parent's `type`, so it stays `unknown[]` and is
   * narrowed at each use site rather than modeled as a union here.
   */
  options?: unknown[];
}

/** An option is a user-supplied parameter (not a sub/group) when its type ≥ 3. */
function isParam(type: number | undefined): boolean {
  return (
    type !== undefined && type !== OPTION_TYPE.SUBCOMMAND && type !== OPTION_TYPE.SUBCOMMAND_GROUP
  );
}

/** Render an option's parameters as bullet lines; '' when it has none. */
function renderParams(options: unknown[] | undefined): string {
  if (!Array.isArray(options)) {
    return '';
  }
  const lines = (options as RawOption[])
    .filter(o => isParam(o.type))
    .map(p => {
      const name = p.name ?? '';
      const desc = p.description ?? '';
      const required = p.required === true ? ' *(required)*' : '';
      return `• \`${name}\`${required}${desc !== '' ? ` — ${desc}` : ''}`;
    });
  return lines.join('\n');
}

/** Build a `{ name, value }` field for one (possibly group-prefixed) subcommand. */
function subcommandField(sub: RawOption, groupName?: string): { name: string; value: string } {
  const subName = sub.name ?? '';
  const label = groupName !== undefined ? `${groupName} ${subName}` : subName;
  const desc = sub.description ?? '';
  const params = renderParams(sub.options);
  const value = [desc, params].filter(part => part !== '').join('\n') || '_No parameters._';
  return { name: `\`${label}\``, value: value.slice(0, FIELD_VALUE_LIMIT) };
}

/**
 * Flatten a command's option tree into one field per subcommand, expanding
 * subcommand groups (`group sub`) and listing each subcommand's parameters.
 */
function buildSubcommandFields(options: unknown[]): { name: string; value: string }[] {
  const fields: { name: string; value: string }[] = [];
  for (const opt of options as RawOption[]) {
    if (opt.type === OPTION_TYPE.SUBCOMMAND_GROUP && Array.isArray(opt.options)) {
      const groupName = opt.name ?? '';
      for (const sub of opt.options as RawOption[]) {
        fields.push(subcommandField(sub, groupName));
      }
    } else if (opt.type === OPTION_TYPE.SUBCOMMAND) {
      fields.push(subcommandField(opt));
    }
  }
  return fields;
}

/**
 * Show detailed help for a specific command, including each subcommand's
 * parameters (or, for a flat command, its own parameters).
 */
async function showCommandDetails(
  context: DeferredCommandContext,
  commands: Map<string, Command>,
  value: string
): Promise<void> {
  const target = resolveHelpTarget(commands, value);

  if (target.kind === 'unknown') {
    await context.editReply({
      content: renderSpec(
        CATALOG.error.notFound('Command', {
          name: `/${value}`,
          hint: 'Use `/help commands` to see all available commands.',
        })
      ),
    });
    return;
  }

  const embed =
    target.kind === 'subcommand'
      ? buildSubcommandEmbed(target.label, target.option)
      : buildOverviewEmbed(target.command);

  await context.editReply({ embeds: [embed] });
}

/** Detail embed for a single subcommand: its description + parameter list. */
function buildSubcommandEmbed(label: string, option: CommandOptionNode): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle(`/${label}`)
    .setDescription(option.description ?? '');

  const params = renderParams(option.options);
  if (params !== '') {
    embed.addFields({ name: 'Parameters', value: params.slice(0, FIELD_VALUE_LIMIT) });
  }
  return embed;
}

/** Overview embed for a command: one field per subcommand, or its own params. */
function buildOverviewEmbed(command: Command): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle(`/${command.data.name}`)
    .setDescription(command.data.description);

  // Read via getCommandOptions (toJSON-backed): the live builder's raw
  // `.options` don't expose a numeric `type`, so the subcommand classification
  // below would otherwise find nothing in production.
  const options = getCommandOptions(command);
  const subcommandFields = buildSubcommandFields(options);

  if (subcommandFields.length > 0) {
    embed.addFields(subcommandFields.slice(0, MAX_DETAIL_FIELDS));
    if (subcommandFields.length > MAX_DETAIL_FIELDS) {
      embed.addFields({
        name: '…and more',
        value: `${subcommandFields.length - MAX_DETAIL_FIELDS} more subcommand(s) not shown.`,
      });
    }
  } else {
    // Flat command (no subcommands) — list its own parameters, if any.
    const params = renderParams(options);
    if (params !== '') {
      embed.addFields({ name: 'Parameters', value: params.slice(0, FIELD_VALUE_LIMIT) });
    }
  }
  return embed;
}

/**
 * Show all commands grouped by category
 */
async function showAllCommands(
  context: DeferredCommandContext,
  commands: Map<string, Command>,
  mentionChar: string
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle('📚 Available Commands')
    .setDescription(
      'Use `/help commands <command>` for detailed information about a specific command.\n\n' +
        'You can also interact with AI characters by @mentioning them!'
    )
    .setTimestamp();

  // Group commands by category
  const categories = new Map<string, Command[]>();

  for (const command of commands.values()) {
    const category = command.category ?? 'Other';
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    const categoryCommands = categories.get(category);
    if (categoryCommands) {
      categoryCommands.push(command);
    }
  }

  // Sort categories by configured order
  const sortedCategories = [...categories.entries()].sort((a, b) => {
    const orderA = CATEGORY_CONFIG[a[0]]?.order ?? 99;
    const orderB = CATEGORY_CONFIG[b[0]]?.order ?? 99;
    return orderA - orderB;
  });

  // Add fields for each category
  for (const [category, cmds] of sortedCategories) {
    const emoji = CATEGORY_CONFIG[category]?.emoji ?? '📦';

    const commandList = cmds
      .map(cmd => {
        const name = cmd.data.name;
        const desc = cmd.data.description;

        // Count subcommands for hint
        let subCount = 0;
        if ('options' in cmd.data && Array.isArray(cmd.data.options)) {
          subCount = cmd.data.options.filter(
            opt => 'type' in opt && (opt.type === 1 || opt.type === 2)
          ).length;
        }

        const subHint = subCount > 0 ? ` *(${subCount} subcommands)*` : '';
        return `\`/${name}\` - ${desc}${subHint}`;
      })
      .join('\n');

    embed.addFields({
      name: `${emoji} ${category}`,
      value: commandList || 'No commands',
      inline: false,
    });
  }

  // Add character mention info
  embed.addFields({
    name: '💬 Character Interactions',
    value:
      `• \`${mentionChar}CharacterName your message\` - Start a conversation\n` +
      '• Reply to their messages to continue chatting\n' +
      '• Use `/chat` to start via slash command',
    inline: false,
  });

  await context.editReply({ embeds: [embed] });
}

// Build command data outside defineCommand to get proper type inference.
// Subcommand shape: Discord removes a command's bare invocation once it has
// subcommands, so the old flat `/help [command]` becomes `/help commands
// [command]`, making room for `/help getting-started` (and future sections).
const commandData = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Learn what Tzurot is and browse every command')
  .addSubcommand(subcommand =>
    subcommand
      .setName('commands')
      .setDescription('Show all available commands')
      .addStringOption(option =>
        option
          .setName('command')
          .setDescription('Get detailed help for a specific command')
          .setRequired(false)
          .setAutocomplete(true)
      )
  )
  .addSubcommand(subcommand =>
    subcommand
      .setName('getting-started')
      .setDescription('What Tzurot is and the first commands to try')
  );

/** Discord caps an autocomplete choice's display name at 100 characters. */
const AUTOCOMPLETE_NAME_LIMIT = 100;

/**
 * Autocomplete for the `command` option.
 *
 * Offers the discrete invocable command paths (subcommands like
 * "admin presence set", group subcommands like "preset override set") so users pick
 * the exact thing they want help with — mirroring Discord's own slash-command
 * picker. A freeform value that doesn't resolve lands on the "Unknown command"
 * path, so steering users to real paths here is the whole point. Matches the
 * typed query as a case-insensitive substring of the path, sorted
 * alphabetically, capped at Discord's choice limit. The choice value is the
 * path itself so `resolveHelpTarget` resolves it directly.
 */
async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused(true);
  if (focused.name !== 'command') {
    return;
  }

  try {
    const commands = interaction.client.commands;
    if (commands === undefined || commands.size === 0) {
      await interaction.respond([]);
      return;
    }

    const query = focused.value.toLowerCase();
    const choices = [...commands.values()]
      .flatMap(flattenCommandLeaves)
      .filter(leaf => query.length === 0 || leaf.path.toLowerCase().includes(query))
      .sort((a, b) => a.path.localeCompare(b.path))
      .slice(0, DISCORD_LIMITS.AUTOCOMPLETE_MAX_CHOICES)
      .map(leaf => ({
        name: `/${leaf.path}${leaf.description.length > 0 ? ` — ${leaf.description}` : ''}`.slice(
          0,
          AUTOCOMPLETE_NAME_LIMIT
        ),
        value: leaf.path,
      }));

    await interaction.respond(choices);
  } catch (error) {
    logger.error({ err: error, query: focused.value }, 'Help command autocomplete failed');
    await interaction.respond([]);
  }
}

/**
 * Export command definition using defineCommand for type safety
 * Category is injected by CommandHandler based on folder structure
 *
 * deferralMode: 'ephemeral' means:
 * - Framework calls deferReply({ ephemeral: true }) before execute()
 * - Execute receives DeferredCommandContext (no deferReply method)
 * - Compile-time prevention of InteractionAlreadyReplied errors
 */
export default defineCommand({
  data: commandData,
  deferralMode: 'ephemeral',
  execute,
  autocomplete,
});
