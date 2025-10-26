/**
 * Bot Client Types
 *
 * Type definitions for Discord bot client.
 */

import type { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import type {
  AttachmentMetadata,
  ApiConversationMessage,
  JobResult,
  GenerateResponse,
  LoadedPersonality
} from '@tzurot/common-types';

// Re-export shared API types
export type {
  AttachmentMetadata,
  ApiConversationMessage,
  JobResult,
  GenerateResponse as GatewayResponse, // Alias for backward compatibility
  LoadedPersonality, // Personality type from database
};

// Deprecated: Use LoadedPersonality instead
export type BotPersonality = LoadedPersonality;

/**
 * Discord environment context
 * Describes where the conversation is taking place
 */
export interface DiscordEnvironmentContext {
  type: 'dm' | 'guild';
  guild?: {
    id: string;
    name: string;
  };
  category?: {
    id: string;
    name: string;
  };
  channel: {
    id: string;
    name: string;
    type: string;
  };
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
 * Message context for AI generation
 * Bot-specific context that gets sent to api-gateway
 */
export interface MessageContext {
  userId: string;
  userName: string;
  channelId: string;
  serverId?: string;
  messageContent: string;
  // Active speaker - the persona making the current request
  activePersonaId?: string;
  activePersonaName?: string;
  conversationHistory?: Array<{
    id?: string; // Internal UUID for deduplication
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt?: string;
    personaId?: string; // Which persona said this message
    personaName?: string; // Persona's name for context
  }>;
  referencedMessage?: {
    author: string;
    content: string;
  };
  // Multimodal support (images, audio, etc)
  attachments?: AttachmentMetadata[];
  // Discord environment context (DMs vs guild, channel info, etc)
  environment?: DiscordEnvironmentContext;
}

/**
 * Slash command definition
 */
export interface Command {
  data: SlashCommandBuilder;
  category?: string;
  execute: (interaction: ChatInputCommandInteraction, ...args: unknown[]) => Promise<void>;
}
