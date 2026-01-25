/**
 * Discord Context Utilities
 *
 * Extracts contextual information about where a Discord message was sent.
 * This helps the AI understand the environment of the conversation.
 */

import type { Message } from 'discord.js';
import { ChannelType } from 'discord.js';
import { createLogger, type DiscordEnvironment } from '@tzurot/common-types';

const logger = createLogger('DiscordContext');

/**
 * Extract environment context from a Discord message
 */
export function extractDiscordEnvironment(message: Message): DiscordEnvironment {
  const channel = message.channel;

  // Debug logging to diagnose DM vs guild detection
  logger.debug(
    {
      channelType: channel.type,
      hasGuild: !!message.guild,
      guildName: message.guild?.name,
      channelId: channel.id,
    },
    'Extracting Discord environment'
  );

  // DM Channel
  if (channel.type === ChannelType.DM) {
    logger.info('Detected as DM');
    return {
      type: 'dm',
      channel: {
        id: channel.id,
        name: 'Direct Message',
        type: 'dm',
      },
    };
  }

  // Guild-based channels
  if (!message.guild) {
    // Shouldn't happen, but handle gracefully
    logger.warn(
      {
        channelType: channel.type,
        channelId: channel.id,
      },
      'No guild found for non-DM channel (fallback to DM)'
    );
    return {
      type: 'dm',
      channel: {
        id: channel.id,
        name: 'Unknown',
        type: 'unknown',
      },
    };
  }

  logger.info(
    {
      guildName: message.guild.name,
      channelName: 'name' in channel ? (channel.name ?? 'Unknown') : 'Unknown',
    },
    'Detected as guild channel'
  );

  const context: DiscordEnvironment = {
    type: 'guild',
    guild: {
      id: message.guild.id,
      name: message.guild.name,
    },
    channel: {
      id: channel.id,
      name: 'name' in channel ? (channel.name ?? 'Unknown') : 'Unknown',
      type: getChannelTypeName(channel.type),
    },
  };

  // Thread Channel
  if (channel.isThread()) {
    const parent = channel.parent;
    if (parent) {
      context.thread = {
        id: channel.id,
        name: channel.name,
        parentChannel: {
          id: parent.id,
          name: parent.name,
          type: getChannelTypeName(parent.type),
        },
      };

      // Update main channel to be the parent
      context.channel = {
        id: parent.id,
        name: parent.name,
        type: getChannelTypeName(parent.type),
      };

      // Check if parent has a category
      if ('parent' in parent && parent.parent) {
        context.category = {
          id: parent.parent.id,
          name: parent.parent.name,
        };
      }
    }
  }
  // Regular channel (text, voice, announcement, etc.)
  else if ('parent' in channel && channel.parent) {
    context.category = {
      id: channel.parent.id,
      name: channel.parent.name,
    };
  }

  return context;
}

/**
 * Convert Discord channel type enum to human-readable name
 */
function getChannelTypeName(type: ChannelType): string {
  switch (type) {
    case ChannelType.GuildText:
      return 'text';
    case ChannelType.DM:
      return 'dm';
    case ChannelType.GuildVoice:
      return 'voice';
    case ChannelType.GroupDM:
      return 'group-dm';
    case ChannelType.GuildCategory:
      return 'category';
    case ChannelType.GuildAnnouncement:
      return 'announcement';
    case ChannelType.AnnouncementThread:
      return 'announcement-thread';
    case ChannelType.PublicThread:
      return 'public-thread';
    case ChannelType.PrivateThread:
      return 'private-thread';
    case ChannelType.GuildStageVoice:
      return 'stage';
    case ChannelType.GuildDirectory:
      return 'directory';
    case ChannelType.GuildForum:
      return 'forum';
    case ChannelType.GuildMedia:
      return 'media';
    default:
      return 'unknown';
  }
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
  if (context.category) {
    parts.push(`Category: ${context.category.name}`);
  }

  // Channel
  parts.push(`Channel: #${context.channel.name} (${context.channel.type})`);

  // Thread (if exists)
  if (context.thread) {
    parts.push(`Thread: ${context.thread.name}`);
  }

  return parts.join(', ');
}
