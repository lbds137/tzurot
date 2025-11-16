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
    if (message.content.length === 0 && message.attachments.size === 0) {
      logger.debug({ messageId: message.id }, '[EmptyMessageFilter] Ignoring empty message');
      return Promise.resolve(true); // Stop processing
    }

    return Promise.resolve(false); // Continue to next processor
  }
}
