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
  GenerateResponse
} from '@tzurot/common-types';

// Re-export shared API types
export type {
  AttachmentMetadata,
  ApiConversationMessage,
  JobResult,
  GenerateResponse as GatewayResponse, // Alias for backward compatibility
};

/**
 * Simple personality configuration
 */
export interface BotPersonality {
  name: string;
  displayName: string;
  avatarUrl?: string;
  systemPrompt: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
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
  conversationHistory?: Array<{
    id?: string; // Internal UUID for deduplication
    role: 'user' | 'assistant' | 'system';
    content: string;
    createdAt?: string;
  }>;
  referencedMessage?: {
    author: string;
    content: string;
  };
  // Multimodal support (images, audio, etc)
  attachments?: AttachmentMetadata[];
}

/**
 * Slash command definition
 */
export interface Command {
  data: SlashCommandBuilder;
  category?: string;
  execute: (interaction: ChatInputCommandInteraction, ...args: unknown[]) => Promise<void>;
}
