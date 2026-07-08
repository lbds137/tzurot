/**
 * Admin Kick Subcommand
 * Handles /admin kick
 *
 * Receives DeferredCommandContext (no deferReply method!)
 * because the parent command uses deferralMode: 'ephemeral'.
 */

import { escapeMarkdown } from 'discord.js';
import { adminKickOptions } from '@tzurot/common-types/generated/commandOptions';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';

const logger = createLogger('admin-kick');

export async function handleKick(context: DeferredCommandContext): Promise<void> {
  const options = adminKickOptions(context.interaction);
  const serverId = options['server-id']();

  try {
    const guild = context.interaction.client.guilds.cache.get(serverId);

    if (!guild) {
      await context.editReply({
        content: renderSpec(
          CATALOG.error.notFound('Server', {
            name: escapeMarkdown(serverId),
            hint: 'Use `/admin servers` to see a list of all servers.',
          })
        ),
      });
      return;
    }

    const serverName = guild.name;

    await guild.leave();

    await context.editReply({
      content: `✅ Successfully left server: **${serverName}** (\`${serverId}\`)`,
    });

    logger.info(
      { serverName, serverId, requestedBy: context.user.id },
      'Left server by admin request'
    );
  } catch (error) {
    logger.error({ err: error, serverId }, 'Error leaving server');
    await context.editReply({
      content: renderSpec(
        CATALOG.error.operationFailed(
          `leave server \`${serverId}\` — it may no longer exist or the bot may lack permissions`
        )
      ),
    });
  }
}

/**
 * Handle /admin usage subcommand
 */
