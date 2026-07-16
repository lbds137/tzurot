/**
 * Notifications Cleanup Handler
 * Handles /notifications cleanup — deletes the user's release-notes DMs from
 * their channel with the bot, on demand.
 *
 * Ledger-driven, never history-scanned: the gateway returns the message ids
 * the delivery ledger recorded at send time, the bot deletes each from the
 * DM channel (10008 "already gone" counts — the goal state is absence), and
 * the confirmed ids are stamped back so no path retries a gone message.
 */

import { DiscordAPIError } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { createSuccessEmbed } from '../../utils/commandHelpers.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import { NOTIFICATIONS_RESOURCE } from './messages.js';

const logger = createLogger('notifications-cleanup');

/** Discord "Unknown Message" — already deleted; absence is the goal state. */
const UNKNOWN_MESSAGE_CODE = 10008;

interface StandingDm {
  deliveryLogId: string;
  messageId: string;
}

/**
 * Delete each standing DM from the channel; returns the ledger ids confirmed
 * gone (a 10008 already-deleted counts). A failed delete is skipped and left
 * un-stamped so a later cleanup or blast retries it.
 */
async function deleteStandingDms(
  dm: { messages: { delete: (id: string) => Promise<unknown> } },
  standing: StandingDm[],
  userId: string
): Promise<string[]> {
  const deletedIds: string[] = [];
  for (const message of standing) {
    try {
      await dm.messages.delete(message.messageId);
      deletedIds.push(message.deliveryLogId);
    } catch (error) {
      if (error instanceof DiscordAPIError && error.code === UNKNOWN_MESSAGE_CODE) {
        deletedIds.push(message.deliveryLogId);
        continue;
      }
      logger.warn({ userId, err: error }, 'Failed to delete a release DM during cleanup — skipped');
    }
  }
  return deletedIds;
}

/** Handle /notifications cleanup */
export async function handleNotificationsCleanup(context: DeferredCommandContext): Promise<void> {
  const userId = context.user.id;
  const failedAction = 'clean up release-notes DMs';

  try {
    const { userClient } = clientsFor(context.interaction);
    const listResult = await userClient.listReleaseDms();

    if (!listResult.ok) {
      logger.warn({ userId, status: listResult.status }, 'Failed to list release DMs');
      await context.editReply({
        content: renderSpec(
          classifyGatewayFailure(listResult, NOTIFICATIONS_RESOURCE, { failedAction })
        ),
      });
      return;
    }

    const standing = listResult.data.messages;
    if (standing.length === 0) {
      const embed = createSuccessEmbed(
        '🧹 Release Notifications',
        'Nothing to clean up — no release notifications are sitting in your DMs.'
      ).setTimestamp();
      await context.editReply({ embeds: [embed] });
      return;
    }

    const dm = await context.interaction.user.createDM();
    const deletedIds = await deleteStandingDms(dm, standing, userId);

    if (deletedIds.length > 0) {
      const markResult = await userClient.markReleaseDmsDeleted({ deliveryLogIds: deletedIds });
      if (!markResult.ok) {
        // The Discord deletes already happened; a lost stamp only means a
        // future cleanup re-confirms via 10008. Report success to the user.
        logger.warn({ userId, status: markResult.status }, 'Failed to stamp cleaned release DMs');
      }
    }

    const embed = createSuccessEmbed(
      '🧹 Release Notifications',
      deletedIds.length === standing.length
        ? `Cleaned up **${deletedIds.length}** release notification${deletedIds.length === 1 ? '' : 's'} from your DMs.`
        : `Cleaned up **${deletedIds.length}** of ${standing.length} release notifications — the rest hit a Discord error; try again in a bit.`
    ).setTimestamp();
    await context.editReply({ embeds: [embed] });
  } catch (error) {
    logger.error({ err: error, userId, command: 'Notifications Cleanup' }, 'Error');
    await context.editReply({
      content: renderSpec(classifyGatewayFailure(error, NOTIFICATIONS_RESOURCE, { failedAction })),
    });
  }
}
