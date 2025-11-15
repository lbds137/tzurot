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
  async process(message: Message): Promise<boolean> {
    if (message.content.length === 0 && message.attachments.size === 0) {
      logger.debug({ messageId: message.id }, '[EmptyMessageFilter] Ignoring empty message');
      return true; // Stop processing
    }

    return false; // Continue to next processor
  }
}
