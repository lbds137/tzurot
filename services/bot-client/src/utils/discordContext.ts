/**
 * Discord Context Utilities
 *
 * Extracts contextual information about where a Discord message was sent.
 * This helps the AI understand the environment of the conversation.
 */

import type { Message } from 'discord.js';
import { ChannelType } from 'discord.js';

export interface DiscordEnvironmentContext {
  /** Whether this is a DM or guild conversation */
  type: 'dm' | 'guild';

  /** Guild information (null for DMs) */
  guild?: {
    id: string;
    name: string;
  };

  /** Channel category (null if uncategorized or in DMs) */
  category?: {
    id: string;
    name: string;
  };

  /** Channel information */
  channel: {
    id: string;
    name: string;
    type: string; // "text", "voice", "forum", "announcement", etc.
  };

  /** Thread information (null if not in a thread) */
  thread?: {
    id: string;
    name: string;
    parentChannel: {
      id: string;
      name: string;
      type: string;
    };
  };
}

/**
 * Extract environment context from a Discord message
 */
export function extractDiscordEnvironment(message: Message): DiscordEnvironmentContext {
  const channel = message.channel;

  // DM Channel
  if (channel.type === ChannelType.DM) {
    return {
      type: 'dm',
      channel: {
        id: channel.id,
        name: 'Direct Message',
        type: 'dm'
      }
    };
  }

  // Guild-based channels
  if (!message.guild) {
    // Shouldn't happen, but handle gracefully
    return {
      type: 'dm',
      channel: {
        id: channel.id,
        name: 'Unknown',
        type: 'unknown'
      }
    };
  }

  const context: DiscordEnvironmentContext = {
    type: 'guild',
    guild: {
      id: message.guild.id,
      name: message.guild.name
    },
    channel: {
      id: channel.id,
      name: 'name' in channel && channel.name ? channel.name : 'Unknown',
      type: getChannelTypeName(channel.type)
    }
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
          type: getChannelTypeName(parent.type)
        }
      };

      // Update main channel to be the parent
      context.channel = {
        id: parent.id,
        name: parent.name,
        type: getChannelTypeName(parent.type)
      };

      // Check if parent has a category
      if ('parent' in parent && parent.parent) {
        context.category = {
          id: parent.parent.id,
          name: parent.parent.name
        };
      }
    }
  }
  // Regular channel (text, voice, announcement, etc.)
  else if ('parent' in channel && channel.parent) {
    context.category = {
      id: channel.parent.id,
      name: channel.parent.name
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
 * Format environment context for display in system prompt
 */
export function formatEnvironmentForPrompt(context: DiscordEnvironmentContext): string {
  if (context.type === 'dm') {
    return 'This conversation is taking place in a **Direct Message** (private one-on-one chat).';
  }

  const parts: string[] = [];

  // Guild name
  parts.push(`**Server**: ${context.guild!.name}`);

  // Category (if exists)
  if (context.category) {
    parts.push(`**Category**: ${context.category.name}`);
  }

  // Channel
  parts.push(`**Channel**: #${context.channel.name} (${context.channel.type})`);

  // Thread (if exists)
  if (context.thread) {
    parts.push(`**Thread**: ${context.thread.name}`);
  }

  return `This conversation is taking place in a Discord server:\n${parts.join('\n')}`;
}
