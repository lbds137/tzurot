/**
 * Discord Context Utilities
 *
 * Extracts contextual information about where a Discord message was sent.
 * This helps the AI understand the environment of the conversation.
 */

import type { Message, GuildBasedChannel, AnyThreadChannel } from 'discord.js';
import { ChannelType } from 'discord.js';
import { createLogger, type DiscordEnvironment } from '@tzurot/common-types';

const logger = createLogger('DiscordContext');

/**
 * Extract topic from a channel if available
 * Only text-based channels have topics
 */
function extractChannelTopic(channel: GuildBasedChannel): string | undefined {
  if ('topic' in channel && channel.topic !== undefined && channel.topic !== null) {
    return channel.topic.length > 0 ? channel.topic : undefined;
  }
  return undefined;
}

/**
 * Get channel name safely with fallback
 */
function getChannelName(channel: GuildBasedChannel): string {
  return 'name' in channel ? (channel.name ?? 'Unknown') : 'Unknown';
}

/**
 * Build environment context for thread channels
 */
function handleThreadChannel(channel: AnyThreadChannel, context: DiscordEnvironment): void {
  const parent = channel.parent;
  if (parent === null) {
    return;
  }

  const parentTopic = extractChannelTopic(parent);

  context.thread = {
    id: channel.id,
    name: channel.name,
    parentChannel: {
      id: parent.id,
      name: parent.name,
      type: getChannelTypeName(parent.type),
    },
  };

  // Update main channel to be the parent (including its topic)
  context.channel = {
    id: parent.id,
    name: parent.name,
    type: getChannelTypeName(parent.type),
    topic: parentTopic,
  };

  // Check if parent has a category
  if ('parent' in parent && parent.parent !== null) {
    context.category = {
      id: parent.parent.id,
      name: parent.parent.name,
    };
  }
}

/**
 * Build environment context for regular (non-thread) channels
 */
function handleRegularChannel(channel: GuildBasedChannel, context: DiscordEnvironment): void {
  if ('parent' in channel && channel.parent !== null) {
    context.category = {
      id: channel.parent.id,
      name: channel.parent.name,
    };
  }
}

/**
 * Extract environment context from a Discord message
 */
export function extractDiscordEnvironment(message: Message): DiscordEnvironment {
  const channel = message.channel;

  logger.debug(
    { channelType: channel.type, hasGuild: message.guild !== null, channelId: channel.id },
    'Extracting Discord environment'
  );

  // DM Channel
  if (channel.type === ChannelType.DM) {
    logger.info('Detected as DM');
    return {
      type: 'dm',
      channel: { id: channel.id, name: 'Direct Message', type: 'dm' },
    };
  }

  // Guild-based channels require a guild
  if (message.guild === null) {
    logger.warn({ channelType: channel.type, channelId: channel.id }, 'No guild found (fallback)');
    return {
      type: 'dm',
      channel: { id: channel.id, name: 'Unknown', type: 'unknown' },
    };
  }

  const guildChannel = channel as GuildBasedChannel;
  logger.info(
    { guildName: message.guild.name, channelName: getChannelName(guildChannel) },
    'Guild channel'
  );

  const context: DiscordEnvironment = {
    type: 'guild',
    guild: { id: message.guild.id, name: message.guild.name },
    channel: {
      id: guildChannel.id,
      name: getChannelName(guildChannel),
      type: getChannelTypeName(guildChannel.type),
      topic: extractChannelTopic(guildChannel),
    },
  };

  // Handle thread vs regular channel
  if (guildChannel.isThread()) {
    handleThreadChannel(guildChannel, context);
  } else {
    handleRegularChannel(guildChannel, context);
  }

  return context;
}

/**
 * Convert Discord channel type enum to human-readable name
 */
function getChannelTypeName(type: ChannelType): string {
  const typeNames: Record<ChannelType, string> = {
    [ChannelType.GuildText]: 'text',
    [ChannelType.DM]: 'dm',
    [ChannelType.GuildVoice]: 'voice',
    [ChannelType.GroupDM]: 'group-dm',
    [ChannelType.GuildCategory]: 'category',
    [ChannelType.GuildAnnouncement]: 'announcement',
    [ChannelType.AnnouncementThread]: 'announcement-thread',
    [ChannelType.PublicThread]: 'public-thread',
    [ChannelType.PrivateThread]: 'private-thread',
    [ChannelType.GuildStageVoice]: 'stage',
    [ChannelType.GuildDirectory]: 'directory',
    [ChannelType.GuildForum]: 'forum',
    [ChannelType.GuildMedia]: 'media',
  };

  return typeNames[type] ?? 'unknown';
}

/**
 * Format environment context for display in system prompt (plain text)
 *
 * Uses simple labeled format that works well inside XML tags.
 * No markdown since this gets embedded in XML structure.
 */
export function formatEnvironmentForPrompt(context: DiscordEnvironment): string {
  if (context.type === 'dm') {
    return 'Direct Message (private one-on-one chat)';
  }

  const parts: string[] = [];

  // Guild name (should always exist if not DM, but handle gracefully)
  const guildName = context.guild?.name ?? 'Unknown Server';
  parts.push(`Server: ${guildName}`);

  // Category (if exists)
  if (context.category !== undefined) {
    parts.push(`Category: ${context.category.name}`);
  }

  // Channel
  parts.push(`Channel: #${context.channel.name} (${context.channel.type})`);

  // Thread (if exists)
  if (context.thread !== undefined) {
    parts.push(`Thread: ${context.thread.name}`);
  }

  return parts.join(', ');
}
