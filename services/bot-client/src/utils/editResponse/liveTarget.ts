/**
 * Live Discord lookups shared by the in-place reply rewrites (Edit Response and
 * Reroll): fetch every chunk of a stored reply, then resolve where edits are
 * written (the channel webhook in guilds, the bot itself in DMs).
 */

import {
  ChannelType,
  type Client,
  type Message,
  type NewsChannel,
  type TextChannel,
  type ThreadChannel,
  type Webhook,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getWebhookManager } from '../../services/serviceRegistry.js';
import { extractDmPrefix } from './chunkPlan.js';
import type { EditTarget } from './discordEdit.js';

const logger = createLogger('edit-response-live-target');

type GuildWebhookChannel = TextChannel | NewsChannel | ThreadChannel;

function isGuildWebhookChannel(channel: unknown): channel is GuildWebhookChannel {
  if (typeof channel !== 'object' || channel === null || !('type' in channel)) {
    return false;
  }
  const type = (channel as { type: ChannelType }).type;
  return (
    type === ChannelType.GuildText ||
    type === ChannelType.GuildAnnouncement ||
    type === ChannelType.PublicThread ||
    type === ChannelType.PrivateThread ||
    type === ChannelType.AnnouncementThread
  );
}

/** Fetch every chunk in stored order; null when any is gone. */
export async function fetchLiveChunks(
  client: Client,
  channelId: string,
  messageIds: readonly string[]
): Promise<{ channel: unknown; chunks: Message[] } | null> {
  try {
    const channel = await client.channels.fetch(channelId);
    if (channel?.isTextBased() !== true) {
      return null;
    }
    const chunks: Message[] = [];
    for (const id of messageIds) {
      chunks.push(await channel.messages.fetch(id));
    }
    return { channel, chunks };
  } catch (error) {
    logger.warn({ err: error, channelId }, 'Could not fetch live reply chunks');
    return null;
  }
}

/** Resolve where the edits are written, or null when the reply is not editable. */
export async function resolveTarget(
  channel: unknown,
  chunks: readonly Message[],
  personalityId: string,
  channelId: string
): Promise<{ target: EditTarget; dmPrefix: string } | null> {
  const first = chunks[0];
  if (first.webhookId === null) {
    // A bot-authored non-webhook message is only a character reply in a DM;
    // in a guild it is some other bot message and must not be edited.
    if (typeof channel !== 'object' || channel === null || !('send' in channel)) {
      return null;
    }
    if ((channel as { isDMBased?: () => boolean }).isDMBased?.() !== true) {
      return null;
    }
    return {
      target: {
        kind: 'dm',
        channel: channel as Extract<EditTarget, { kind: 'dm' }>['channel'],
        personalityId,
      },
      dmPrefix: extractDmPrefix(first.content),
    };
  }
  if (!isGuildWebhookChannel(channel)) {
    return null;
  }
  // WebhookManager has no lookup-only accessor: `getWebhook` creates a webhook
  // when none exists, and throws when it cannot. Either way a failure here is a
  // refusal to edit, not an error to surface.
  let webhook: Webhook;
  try {
    webhook = await getWebhookManager().getWebhook(channel);
  } catch (error) {
    logger.warn({ err: error, channelId }, 'Could not resolve the channel webhook; not editing');
    return null;
  }
  if (chunks.some(chunk => chunk.webhookId !== webhook.id)) {
    logger.warn({ channelId }, 'Live chunks belong to a different webhook; not editing');
    return null;
  }
  return {
    target: {
      kind: 'webhook',
      webhook,
      threadId: channel.isThread() ? channel.id : undefined,
      username: first.author.username,
      avatarURL: first.author.displayAvatarURL(),
      personalityId,
    },
    dmPrefix: '',
  };
}
