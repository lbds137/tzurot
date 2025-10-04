/**
 * Help Command
 * Lists all available commands with descriptions
 */

import { SlashCommandBuilder, ChatInputCommandInteraction, EmbedBuilder } from 'discord.js';
import type { Command } from '../../types.js';

export const data = new SlashCommandBuilder()
  .setName('help')
  .setDescription('Show all available commands');

export async function execute(
  interaction: ChatInputCommandInteraction,
  commands: Map<string, Command>
): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
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
      .map(cmd => `\`/${cmd.data.name}\` - ${cmd.data.description}`)
      .join('\n');

    embed.addFields({ name: category, value: commandList, inline: false });
  }

  await interaction.reply({ embeds: [embed] });
}
