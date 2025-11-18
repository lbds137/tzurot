/**
 * Utility Ping Subcommand
 * Handles /utility ping
 */

import type { ChatInputCommandInteraction } from 'discord.js';

/**
 * Handle /utility ping subcommand
 */
export async function handlePing(interaction: ChatInputCommandInteraction): Promise<void> {
  // Use deferReply to get response timing
  await interaction.deferReply();

  const latency = Date.now() - interaction.createdTimestamp;

  await interaction.editReply(`Pong! Latency: ${latency}ms`);
}

/**
 * Handle /utility help subcommand
 */
