/**
 * Reply Reference Strategy
 *
 * Extracts reply-to references from Discord messages
 */

import type { Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { IReferenceStrategy } from './IReferenceStrategy.js';
import type { ReferenceResult } from '../types.js';
import { ReferenceType } from '../types.js';

const logger = createLogger('ReplyReferenceStrategy');

/**
 * Strategy for extracting reply-to references
 */
export class ReplyReferenceStrategy implements IReferenceStrategy {
  /**
   * Extract reply-to reference if present
   * @param message - Discord message to check
   * @returns Array with single reference if reply exists, empty otherwise
   */
  extract(message: Message): Promise<ReferenceResult[]> {
    // Check if message is a reply
    if (message.reference?.messageId === undefined || message.reference?.messageId === null) {
      return Promise.resolve([]);
    }

    // Extract guild and channel IDs from the message
    const guildId = message.guildId;
    const channelId = message.channelId;

    if (guildId === null || guildId === undefined || channelId === null || channelId === undefined) {
      logger.debug(
        {
          messageId: message.id,
          hasGuildId: guildId !== null && guildId !== undefined,
          hasChannelId: channelId !== null && channelId !== undefined,
        },
        '[ReplyReferenceStrategy] Skipping reply reference - missing guild or channel ID'
      );
      return Promise.resolve([]);
    }

    logger.debug(
      {
        messageId: message.id,
        referencedMessageId: message.reference.messageId,
      },
      '[ReplyReferenceStrategy] Found reply reference'
    );

    return Promise.resolve([
      {
        messageId: message.reference.messageId,
        channelId,
        guildId,
        type: ReferenceType.REPLY,
      },
    ]);
  }
}
