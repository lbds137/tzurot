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
import { getConfig } from '@tzurot/common-types/config/config';
import { DISCORD_COLORS, DISCORD_LIMITS } from '@tzurot/common-types/constants/discord';
import { helpOptions } from '@tzurot/common-types/generated/commandOptions';
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
export const CATEGORY_CONFIG: Record<string, { emoji: string; order: number }> = {
  Character: { emoji: '🎭', order: 1 },
  Persona: { emoji: '👤', order: 2 },
  Preset: { emoji: '🎛️', order: 3 },
  Settings: { emoji: '⚙️', order: 4 },
  Voice: { emoji: '🔊', order: 5 },
  Shapes: { emoji: '🧩', order: 6 },
  Memory: { emoji: '🧠', order: 7 },
  History: { emoji: '📜', order: 8 },
  Channel: { emoji: '#️⃣', order: 9 },
  Inspect: { emoji: '🔍', order: 10 },
  Models: { emoji: '🤖', order: 11 },
  Deny: { emoji: '🚫', order: 12 },
  Admin: { emoji: '🛡️', order: 13 },
  Help: { emoji: '❓', order: 14 },
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
  // Access commands via the interaction.client - attached during bot startup
  const commands = context.interaction.client.commands;

  if (commands === undefined || commands.size === 0) {
    logger.error('Commands collection not available on client');
    await context.editReply({
      content: '❌ Unable to load commands list. Please try again later.',
    });
    return;
  }

  const options = helpOptions(context.interaction);
  const specificCommand = options.command();
  const config = getConfig();
  const mentionChar = config.BOT_MENTION_CHAR;

  if (specificCommand !== null && specificCommand !== '') {
    await showCommandDetails(context, commands, specificCommand);
  } else {
    await showAllCommands(context, commands, mentionChar);
  }
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
      content: `❌ Unknown command: \`/${value}\`\n\nUse \`/help\` to see all available commands.`,
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
      'Use `/help <command>` for detailed information about a specific command.\n\n' +
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
      '• Use `/character chat` to start via slash command',
    inline: false,
  });

  await context.editReply({ embeds: [embed] });
}

// Build command data outside defineCommand to get proper type inference
const commandData = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all available commands')
  .addStringOption(option =>
    option
      .setName('command')
      .setDescription('Get detailed help for a specific command')
      .setRequired(false)
      .setAutocomplete(true)
  );

/** Discord caps an autocomplete choice's display name at 100 characters. */
const AUTOCOMPLETE_NAME_LIMIT = 100;

/**
 * Autocomplete for the `command` option.
 *
 * Offers the discrete invocable command paths (subcommands like
 * "character chat", group subcommands like "admin presence set") so users pick
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
