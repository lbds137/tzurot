/**
 * Empty Message Filter
 *
 * Filters out messages with no content and no attachments.
 * Prevents processing of completely empty messages.
 *
 * Uses centralized isForwardedMessage from forwardedMessageUtils.ts.
 */

import type { Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { IMessageProcessor } from './IMessageProcessor.js';
import { isForwardedMessage } from '../utils/forwardedMessageUtils.js';
import { hasStickerOrPoll } from '../utils/stickerPollDescriptions.js';

const logger = createLogger('EmptyMessageFilter');

export class EmptyMessageFilter implements IMessageProcessor {
  process(message: Message): Promise<boolean> {
    // Check for direct attachments
    const hasDirectAttachments = message.attachments.size > 0;

    // Forwarded messages are never empty (even without snapshots, Discord may have content elsewhere)
    // This prevents filtering out forwarded images/voice where Discord may not populate snapshots
    if (isForwardedMessage(message)) {
      return Promise.resolve(false); // Continue to next processor
    }

    // Check for message snapshots with attachments
    // Note: We check snapshots directly without requiring forward reference type,
    // because snapshots can sometimes exist without the proper reference type
    // (safer to process than to incorrectly filter out)
    let hasSnapshotAttachments = false;
    if (
      message.messageSnapshots !== null &&
      message.messageSnapshots !== undefined &&
      message.messageSnapshots.size > 0
    ) {
      for (const snapshot of message.messageSnapshots.values()) {
        if (
          snapshot.attachments !== null &&
          snapshot.attachments !== undefined &&
          snapshot.attachments.size > 0
        ) {
          hasSnapshotAttachments = true;
          break;
        }
      }
    }

    // A sticker or poll IS the message when it carries nothing else — and this
    // filter runs at chain position 3, ahead of the trigger and DM processors,
    // so dropping here means the bot never responds at all to someone who
    // @-mentions it with just a sticker.
    if (hasStickerOrPoll(message)) {
      return Promise.resolve(false); // Continue to next processor
    }

    // Only filter if message has no content AND no attachments (direct or snapshot)
    if (message.content.length === 0 && !hasDirectAttachments && !hasSnapshotAttachments) {
      logger.debug({ messageId: message.id }, 'Ignoring empty message');
      return Promise.resolve(true); // Stop processing
    }

    return Promise.resolve(false); // Continue to next processor
  }
}
