/**
 * Fetch a Discord channel by ID and narrow it to a {@link TypingChannel}
 * (a channel the bot can send/typing-indicate in).
 *
 * Used by paths that reconstruct a delivery target after the in-memory
 * Discord objects are gone — multi-tag restart recovery and late-result
 * recovery. Returns null on fetch failure, missing channel, or a channel
 * type the bot can't deliver to (category, stage, etc.).
 */

import type { Channel, Client, Message } from 'discord.js';
import { isTypingChannel, type TypingChannel } from '@tzurot/common-types/types/discord-types';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('fetchTypingChannel');

export async function fetchTypingChannel(
  client: Client,
  channelId: string
): Promise<TypingChannel | null> {
  try {
    const channel: Channel | null = await client.channels.fetch(channelId);
    if (channel === null) {
      return null;
    }
    // `isTypingChannel` expects a `Message['channel']`-typed value, but the
    // type guard's predicate works structurally — cast through unknown.
    if (!isTypingChannel(channel as unknown as Message['channel'])) {
      return null;
    }
    return channel as unknown as TypingChannel;
  } catch (err) {
    logger.warn({ err, channelId }, 'fetchTypingChannel: channel fetch failed');
    return null;
  }
}
