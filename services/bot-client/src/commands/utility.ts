/**
 * Utility Command Group
 * Groups utility commands under /utility with subcommands
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import type { Command } from '../types.js';

export const data = new SlashCommandBuilder()
  .setName('utility')
  .setDescription('Utility commands')
  .addSubcommand(subcommand =>
    subcommand.setName('ping').setDescription('Check if bot is responding')
  )
  .addSubcommand(subcommand =>
    subcommand.setName('help').setDescription('Show all available commands')
  );

export async function execute(
  interaction: ChatInputCommandInteraction,
  commands?: Map<string, Command>
): Promise<void> {
  const subcommand = interaction.options.getSubcommand();

  switch (subcommand) {
    case 'ping':
      await handlePing(interaction);
      break;
    case 'help':
      await handleHelp(interaction, commands);
      break;
    default:
      await interaction.reply({
        content: '❌ Unknown subcommand',
        ephemeral: true,
      });
  }
}

/**
 * Handle /utility ping subcommand
 */
async function handlePing(interaction: ChatInputCommandInteraction): Promise<void> {
  // Use deferReply to get response timing
  await interaction.deferReply();

  const latency = Date.now() - interaction.createdTimestamp;

  await interaction.editReply(`Pong! Latency: ${latency}ms`);
}

/**
 * Handle /utility help subcommand
 */
async function handleHelp(
  interaction: ChatInputCommandInteraction,
  commands?: Map<string, Command>
): Promise<void> {
  if (!commands) {
    await interaction.reply({
      content: '❌ Commands list not available',
      ephemeral: true,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Available Commands')
    .setDescription('Here are all the commands you can use:')
    .setTimestamp();

  // Group commands by category
  const categories = new Map<string, Command[]>();

  for (const command of commands.values()) {
    const category = command.category || 'Other';
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category)!.push(command);
  }

  // Add fields for each category
  for (const [category, cmds] of categories.entries()) {
    const commandList = cmds
      .map(cmd => {
        // Show subcommands for grouped commands
        const cmdName = cmd.data.name;
        const description = cmd.data.description;

        // Check if this is a command with subcommands
        if ('options' in cmd.data && Array.isArray(cmd.data.options)) {
          const subcommands = cmd.data.options
            .filter(opt => 'type' in opt && opt.type === 1) // Type 1 = Subcommand
            .filter(opt => 'name' in opt && 'description' in opt)
            .map(
              sub =>
                `  • \`/${cmdName} ${'name' in sub ? sub.name : ''}\` - ${'description' in sub ? sub.description : ''}`
            )
            .join('\n');

          if (subcommands) {
            return `\`/${cmdName}\` - ${description}\n${subcommands}`;
          }
        }

        return `\`/${cmdName}\` - ${description}`;
      })
      .join('\n\n');

    embed.addFields({ name: category, value: commandList, inline: false });
  }

  // Add personality mention info
  embed.addFields({
    name: 'Personality Interactions',
    value:
      'You can also interact with AI personalities by mentioning them:\n' +
      '• `@PersonalityName your message` - Start a conversation\n' +
      '• Reply to their messages to continue the conversation',
    inline: false,
  });

  await interaction.reply({ embeds: [embed] });
}
