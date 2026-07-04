/**
 * Link Reference Strategy
 *
 * Extracts message link references from Discord message content
 */

import type { Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { MessageLinkParser } from '@tzurot/common-types/utils/messageLinkParser';
import { extractForwardedContent } from '../../../utils/forwardedMessageUtils.js';
import type { IReferenceStrategy } from './IReferenceStrategy.js';
import { type ReferenceResult, ReferenceType } from '../types.js';

const logger = createLogger('LinkReferenceStrategy');

/**
 * Strategy for extracting Discord message links from content
 */
export class LinkReferenceStrategy implements IReferenceStrategy {
  /**
   * Extract message links from content
   * @param message - Discord message to extract from
   * @returns Array of reference results from parsed links
   */
  extract(message: Message): Promise<ReferenceResult[]> {
    // Use the effective content so links embedded in a FORWARDED message's
    // snapshot are detected — `message.content` is empty for forwards, which
    // would otherwise drop their links from `[Reference N]` numbering.
    // extractForwardedContent falls back to message.content for non-forwards.
    const links = MessageLinkParser.parseMessageLinks(extractForwardedContent(message));

    if (links.length === 0) {
      return Promise.resolve([]);
    }

    logger.debug(
      {
        messageId: message.id,
        linkCount: links.length,
      },
      'Found message links'
    );

    // Convert parsed links to reference results
    return Promise.resolve(
      links.map(link => ({
        messageId: link.messageId,
        channelId: link.channelId,
        guildId: link.guildId,
        type: ReferenceType.LINK,
        discordUrl: link.fullUrl,
      }))
    );
  }
}
