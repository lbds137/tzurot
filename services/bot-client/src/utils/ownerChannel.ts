/**
 * Best-effort embed delivery to the private owner channel (FEEDBACK_CHANNEL_ID).
 *
 * Shared by the surfaces that notify the owner without pinging anyone:
 * /feedback submissions and the release-broadcast completion report. Never
 * throws — every caller's primary action has already succeeded server-side,
 * so a failed post loses only the notification. Unset channel id → silent
 * no-op (the documented degrade for single-owner deployments without the
 * channel configured).
 *
 * Returns whether the embed was actually delivered, so callers that arm a
 * suppression window (nag cooldowns) can skip arming it on a failed post —
 * fire-and-forget callers may ignore the return value.
 */

import { type Client, type EmbedBuilder } from 'discord.js';
import { getConfig } from '@tzurot/common-types/config/config';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('owner-channel');

export async function postOwnerChannelEmbed(client: Client, embed: EmbedBuilder): Promise<boolean> {
  const channelId = getConfig().FEEDBACK_CHANNEL_ID;
  if (channelId === undefined) {
    return false;
  }
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel === null || !channel.isTextBased() || !('send' in channel)) {
      logger.warn({ channelId }, 'FEEDBACK_CHANNEL_ID is not a sendable text channel');
      return false;
    }
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
    return true;
  } catch (error) {
    logger.warn({ err: error, channelId }, 'Failed to post embed to owner channel');
    return false;
  }
}
