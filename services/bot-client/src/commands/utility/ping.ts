/**
 * Ping Command
 * Simple health check command to verify bot responsiveness
 */

import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';

export const data = new SlashCommandBuilder()
  .setName('ping')
  .setDescription('Check if bot is responding');

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  // Use deferReply to get response timing
  await interaction.deferReply();

  const latency = Date.now() - interaction.createdTimestamp;

  await interaction.editReply(`Pong! Latency: ${latency}ms`);
}
