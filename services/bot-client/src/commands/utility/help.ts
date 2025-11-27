/**
 * Utility Help Subcommand
 * Handles /utility help
 */

import type { ChatInputCommandInteraction } from 'discord.js';
import { EmbedBuilder, MessageFlags } from 'discord.js';
import type { Command } from '../../types.js';
import { DISCORD_COLORS } from '@tzurot/common-types';

export async function handleHelp(
  interaction: ChatInputCommandInteraction,
  commands?: Map<string, Command>
): Promise<void> {
  if (!commands) {
    await interaction.reply({
      content: '❌ Commands list not available',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const embed = new EmbedBuilder()
    .setColor(DISCORD_COLORS.BLURPLE)
    .setTitle('Available Commands')
    .setDescription('Here are all the commands you can use:')
    .setTimestamp();

  // Group commands by category
  const categories = new Map<string, Command[]>();

  for (const command of commands.values()) {
    const category =
      command.category !== undefined && command.category.length > 0 ? command.category : 'Other';
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    const categoryCommands = categories.get(category);
    if (categoryCommands !== undefined) {
      categoryCommands.push(command);
    }
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
            .map(sub => {
              const subName = 'name' in sub && typeof sub.name === 'string' ? sub.name : '';
              const subDesc =
                'description' in sub && typeof sub.description === 'string' ? sub.description : '';
              return `  • \`/${cmdName} ${subName}\` - ${subDesc}`;
            })
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
