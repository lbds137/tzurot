/**
 * Admin Ping Subcommand
 * Handles /admin ping - checks bot responsiveness and latency
 */

import type { ChatInputCommandInteraction } from 'discord.js';

/**
 * Handle /admin ping subcommand
 */
export async function handlePing(interaction: ChatInputCommandInteraction): Promise<void> {
  // Note: deferReply is handled by top-level interactionCreate handler
  const latency = Date.now() - interaction.createdTimestamp;
  const wsLatency = interaction.client.ws.ping;

  await interaction.editReply(
    `🏓 **Pong!**\n` + `• Response latency: ${latency}ms\n` + `• WebSocket latency: ${wsLatency}ms`
  );
}
