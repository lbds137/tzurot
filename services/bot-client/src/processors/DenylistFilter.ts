/**
 * Denylist Filter
 *
 * Silently filters out messages from denylisted users and guilds.
 * Second processor in the chain (after BotMessageFilter).
 *
 * Checks bot-wide and channel-scoped denials.
 * Personality-scoped denial is checked later in PersonalityMessageHandler
 * (since the personality isn't resolved yet at this stage).
 *
 * The bot owner is never filtered — safety guard against self-lockout.
 */

import type { Message } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import type { IMessageProcessor } from './IMessageProcessor.js';
import type { DenylistCache } from '../services/DenylistCache.js';
import { getThreadParentId } from '../utils/discordChannelTypes.js';

const logger = createLogger('DenylistFilter');

export class DenylistFilter implements IMessageProcessor {
  constructor(private readonly denylistCache: DenylistCache) {}

  process(message: Message): Promise<boolean> {
    // Safety: never deny the bot owner
    if (isBotOwner(message.author.id)) {
      return Promise.resolve(false);
    }

    // Check bot-wide guild denial
    if (message.guildId !== null && this.denylistCache.isBotDenied('', message.guildId)) {
      logger.debug({ guildId: message.guildId }, 'Message from denied guild');
      return Promise.resolve(true);
    }

    // Check bot-wide user denial
    if (this.denylistCache.isBotDenied(message.author.id)) {
      logger.debug({ userId: message.author.id }, 'Message from denied user');
      return Promise.resolve(true);
    }

    // Check guild-scoped user denial
    if (
      message.guildId !== null &&
      this.denylistCache.isUserGuildDenied(message.author.id, message.guildId)
    ) {
      logger.debug(
        { userId: message.author.id, guildId: message.guildId },
        'Message from user denied in this guild'
      );
      return Promise.resolve(true);
    }

    // Check channel-scoped user denial, with thread→parent inheritance
    // (see DenylistCache.isChannelDenied for the mode semantics).
    const parentId = getThreadParentId(message.channel);
    if (this.denylistCache.isChannelDenied(message.author.id, message.channelId, parentId)) {
      logger.debug(
        { userId: message.author.id, channelId: message.channelId, parentChannelId: parentId },
        'Message from user denied in channel'
      );
      return Promise.resolve(true);
    }

    return Promise.resolve(false);
  }
}
