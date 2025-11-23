/**
 * Link Reference Strategy
 *
 * Extracts message link references from Discord message content
 */

import type { Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import { MessageLinkParser } from '../../../utils/MessageLinkParser.js';
import type { IReferenceStrategy } from './IReferenceStrategy.js';
import type { ReferenceResult } from '../types.js';
import { ReferenceType } from '../types.js';

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
    // Parse message links from content
    const links = MessageLinkParser.parseMessageLinks(message.content);

    if (links.length === 0) {
      return Promise.resolve([]);
    }

    logger.debug(
      {
        messageId: message.id,
        linkCount: links.length,
      },
      '[LinkReferenceStrategy] Found message links'
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
