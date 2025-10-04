/**
 * Ping Command
 * Simple health check command to verify bot responsiveness
 */

import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check if bot is responding');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
  const latency = sent.createdTimestamp - interaction.createdTimestamp;

  await interaction.editReply(`Pong! Latency: ${latency}ms`);
}
