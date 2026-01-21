/**
 * Admin Kick Subcommand
 * Handles /admin kick
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-kick');

export async function handleKick(context: DeferredCommandContext): Promise<void> {
  const serverId = context.getRequiredOption<string>('server-id');

  try {
    const guild = context.interaction.client.guilds.cache.get(serverId);

    if (!guild) {
      await context.editReply({
        content:
          `❌ Bot is not in a server with ID \`${serverId}\`.\n\n` +
          'Use `/admin servers` to see a list of all servers.',
      });
      return;
    }

    const serverName = guild.name;

    await guild.leave();

    await context.editReply({
      content: `✅ Successfully left server: **${serverName}** (\`${serverId}\`)`,
    });

    logger.info(
      `[Admin] Left server: ${serverName} (${serverId}) by request of ${context.user.id}`
    );
  } catch (error) {
    logger.error({ err: error }, `Error leaving server ${serverId}`);
    await context.editReply({
      content:
        `❌ Failed to leave server \`${serverId}\`.\n\n` +
        'The server may no longer exist or bot may lack permissions.',
    });
  }
}

/**
 * Handle /admin usage subcommand
 */
