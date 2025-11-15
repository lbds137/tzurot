/**
 * Bot Message Filter
 *
 * Filters out messages from bot accounts.
 * First processor in the chain - prevents bots from triggering each other.
 */

import type { Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types';
import type { IMessageProcessor } from './IMessageProcessor.js';

const logger = createLogger('BotMessageFilter');

export class BotMessageFilter implements IMessageProcessor {
  async process(message: Message): Promise<boolean> {
    if (message.author.bot) {
      logger.debug({ authorId: message.author.id }, '[BotMessageFilter] Ignoring bot message');
      return true; // Stop processing
    }

    return false; // Continue to next processor
  }
}
