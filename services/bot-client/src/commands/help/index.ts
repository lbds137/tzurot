/**
 * Help Command
 * Top-level /help command for discoverability
 *
 * Shows all available commands grouped by category
 *
 * Note: This command uses editReply() because interactions are deferred
 * at the top level in index.ts. Ephemerality is set by deferReply().
 */

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
import { createLogger, DISCORD_COLORS, getConfig } from '@tzurot/common-types';
import type { Command } from '../../types.js';

const logger = createLogger('help-command');

/**
 * Slash command definition
 */
export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all available commands')
  .addStringOption(option =>
    option
      .setName('command')
      .setDescription('Get detailed help for a specific command')
      .setRequired(false)
  );

/**
 * Command category display order and emoji
 */
const CATEGORY_CONFIG: Record<string, { emoji: string; order: number }> = {
  Character: { emoji: '🎭', order: 1 },
  Me: { emoji: '👤', order: 2 },
  Preset: { emoji: '⚙️', order: 3 },
  History: { emoji: '📜', order: 4 },
  Wallet: { emoji: '🔑', order: 5 },
  Admin: { emoji: '🛡️', order: 6 },
  Help: { emoji: '❓', order: 7 },
  Other: { emoji: '📦', order: 99 },
};

/**
 * Command execution
 */
export async function execute(
  interaction: ChatInputCommandInteraction,
  commands?: Map<string, Command>
): Promise<void> {
  if (!commands) {
    logger.error({}, 'Commands map not provided to help command');
    await interaction.editReply({
      content: '❌ Unable to load commands list. Please try again later.',
    });
    return;
  }

  const specificCommand = interaction.options.getString('command');
  const config = getConfig();
  const mentionChar = config.BOT_MENTION_CHAR;

  if (specificCommand !== null && specificCommand !== '') {
    await showCommandDetails(interaction, commands, specificCommand);
  } else {
    await showAllCommands(interaction, commands, mentionChar);
  }
}

/**
 * Show detailed help for a specific command
 */
async function showCommandDetails(
  interaction: ChatInputCommandInteraction,
  commands: Map<string, Command>,
  commandName: string
): Promise<void> {
  const command = commands.get(commandName.toLowerCase());

  if (!command) {
    await interaction.editReply({
      content: `❌ Unknown command: \`/${commandName}\`\n\nUse \`/help\` to see all available commands.`,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle(`/${command.data.name}`)
    .setDescription(command.data.description);

  // Add subcommands if present
  if ('options' in command.data && Array.isArray(command.data.options)) {
    const subcommands = command.data.options.filter(
      opt => 'type' in opt && (opt.type === 1 || opt.type === 2) // Subcommand or SubcommandGroup
    );

    if (subcommands.length > 0) {
      const subcommandList = subcommands
        .map(sub => {
          const name = 'name' in sub ? String(sub.name) : '';
          const desc = 'description' in sub ? String(sub.description) : '';
          const type = 'type' in sub && sub.type === 2 ? ' (group)' : '';
          return `\`${name}\`${type} - ${desc}`;
        })
        .join('\n');

      embed.addFields({ name: 'Subcommands', value: subcommandList });
    }
  }

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Show all commands grouped by category
 */
async function showAllCommands(
  interaction: ChatInputCommandInteraction,
  commands: Map<string, Command>,
  mentionChar: string
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle('📚 Available Commands')
    .setDescription(
      'Use `/help <command>` for detailed information about a specific command.\n\n' +
        'You can also interact with AI personalities by @mentioning them!'
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

  // Add personality mention info
  embed.addFields({
    name: '💬 Personality Interactions',
    value:
      `• \`${mentionChar}PersonalityName your message\` - Start a conversation\n` +
      '• Reply to their messages to continue chatting\n' +
      '• Use `/character chat` to start via slash command',
    inline: false,
  });

  await interaction.editReply({ embeds: [embed] });
}

/**
 * Category for this command
 */
export const category = 'Help';
