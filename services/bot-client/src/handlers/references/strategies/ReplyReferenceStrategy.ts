/**
 * Reply Reference Strategy
 *
 * Extracts reply-to references from Discord messages
 */

import { type Message, MessageReferenceType } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { IReferenceStrategy } from './IReferenceStrategy.js';
import { type ReferenceResult, ReferenceType } from '../types.js';

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

    // Forwarded messages (Discord's Forward feature) also populate `message.reference`
    // but with `type === MessageReferenceType.Forward`. Forwards are handled separately
    // via message snapshots — don't treat them as reply references.
    // Default reference type when omitted is `Default` (replies), so absence is allowed.
    if (
      message.reference.type !== undefined &&
      message.reference.type !== MessageReferenceType.Default
    ) {
      return Promise.resolve([]);
    }

    // For DM channels, `message.guildId` is null per discord.js semantics.
    // The downstream fetcher uses `channelId` to retrieve the parent message; access
    // is verified via `LinkExtractor.verifyInvokerCanAccessSource` which has a
    // DM-aware branch (`channel.isDMBased()` → check `recipientId === invokerId`).
    // So a null guildId is valid here as long as channelId is present.
    const guildId = message.guildId;
    const channelId = message.channelId;

    if (channelId === null || channelId === undefined) {
      logger.debug({ messageId: message.id }, 'Skipping reply reference - missing channel ID');
      return Promise.resolve([]);
    }

    logger.debug(
      {
        messageId: message.id,
        referencedMessageId: message.reference.messageId,
        isDM: guildId === null,
      },
      'Found reply reference'
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
