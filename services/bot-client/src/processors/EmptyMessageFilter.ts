/**
 * Empty Message Filter
 *
 * Filters out messages with no content and no attachments.
 * Prevents processing of completely empty messages.
 */

import type { Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { IMessageProcessor } from './IMessageProcessor.js';

const logger = createLogger('EmptyMessageFilter');

export class EmptyMessageFilter implements IMessageProcessor {
  process(message: Message): Promise<boolean> {
    // Check for direct attachments
    const hasDirectAttachments = message.attachments.size > 0;

    // Check for forwarded message snapshots with attachments
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

    // Only filter if message has no content AND no attachments (direct or snapshot)
    if (message.content.length === 0 && !hasDirectAttachments && !hasSnapshotAttachments) {
      logger.debug({ messageId: message.id }, '[EmptyMessageFilter] Ignoring empty message');
      return Promise.resolve(true); // Stop processing
    }

    return Promise.resolve(false); // Continue to next processor
  }
}
