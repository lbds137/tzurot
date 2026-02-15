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
import { createLogger, isBotOwner } from '@tzurot/common-types';
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
      logger.debug({ guildId: message.guildId }, '[DenylistFilter] Message from denied guild');
      return Promise.resolve(true);
    }

    // Check bot-wide user denial
    if (this.denylistCache.isBotDenied(message.author.id)) {
      logger.debug({ userId: message.author.id }, '[DenylistFilter] Message from denied user');
      return Promise.resolve(true);
    }

    // Check guild-scoped user denial
    if (
      message.guildId !== null &&
      this.denylistCache.isUserGuildDenied(message.author.id, message.guildId)
    ) {
      logger.debug(
        { userId: message.author.id, guildId: message.guildId },
        '[DenylistFilter] Message from user denied in this guild'
      );
      return Promise.resolve(true);
    }

    // Check channel-scoped user denial (thread-specific first, then parent).
    // Both BLOCK and MUTE prevent the bot from responding here. This differs from
    // DenylistCache.isBlocked() which only inherits BLOCK from parent (MUTE messages
    // still appear in context but the bot won't respond to them).
    const parentId = getThreadParentId(message.channel);
    const channelIdsToCheck =
      parentId !== null ? [message.channelId, parentId] : [message.channelId];

    for (const channelId of channelIdsToCheck) {
      if (this.denylistCache.isChannelDenied(message.author.id, channelId)) {
        logger.debug(
          { userId: message.author.id, channelId: message.channelId, deniedIn: channelId },
          '[DenylistFilter] Message from user denied in channel'
        );
        return Promise.resolve(true);
      }
    }

    return Promise.resolve(false);
  }
}
