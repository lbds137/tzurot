/**
 * Admin Ping Subcommand
 * Handles /admin ping - checks bot responsiveness and latency
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

/**
 * Handle /admin ping subcommand
 */
export async function handlePing(context: DeferredCommandContext): Promise<void> {
  const latency = Date.now() - context.interaction.createdTimestamp;
  const wsLatency = context.interaction.client.ws.ping;

  await context.editReply(
    `🏓 **Pong!**\n` + `• Response latency: ${latency}ms\n` + `• WebSocket latency: ${wsLatency}ms`
  );
}
