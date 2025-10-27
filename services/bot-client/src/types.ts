/**
 * Bot Client Types
 *
 * Type definitions for Discord bot client.
 */

import type { ChatInputCommandInteraction, ModalSubmitInteraction, SlashCommandBuilder } from 'discord.js';
import type {
  AttachmentMetadata,
  ApiConversationMessage,
  JobResult,
  GenerateResponse,
  LoadedPersonality,
  DiscordEnvironment,
  RequestContext
} from '@tzurot/common-types';

// Re-export shared API types
export type {
  AttachmentMetadata,
  ApiConversationMessage,
  JobResult,
  GenerateResponse,
  LoadedPersonality,
  DiscordEnvironment,
};

/**
 * Message context for AI generation
 * Bot-specific context that gets sent to api-gateway
 * Extends RequestContext from common-types with bot-specific messageContent field
 */
export interface MessageContext extends Omit<RequestContext, 'conversationHistory'> {
  messageContent: string;
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
}

/**
 * Slash command definition
 */
export interface Command {
  data: SlashCommandBuilder;
  category?: string;
  execute: (interaction: ChatInputCommandInteraction | ModalSubmitInteraction, ...args: unknown[]) => Promise<void>;
}
