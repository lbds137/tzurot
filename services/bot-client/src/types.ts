/**
 * Bot Client Types
 *
 * Type definitions for Discord bot client.
 */

import type {
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import type {
  AttachmentMetadata,
  ApiConversationMessage,
  GenerateResponse,
  LoadedPersonality,
  DiscordEnvironment,
  MentionedPersona,
  RequestContext,
  ReferencedMessage,
} from '@tzurot/common-types';
import { MessageRole } from '@tzurot/common-types';

// Re-export shared API types
export type {
  AttachmentMetadata,
  ApiConversationMessage,
  GenerateResponse,
  LoadedPersonality,
  DiscordEnvironment,
  MentionedPersona,
  ReferencedMessage,
};

/**
 * Message context for AI generation
 * Bot-specific context that gets sent to api-gateway
 * Extends RequestContext from common-types with bot-specific messageContent field
 */
export interface MessageContext extends Omit<RequestContext, 'conversationHistory'> {
  messageContent: string;
  conversationHistory?: {
    id?: string; // Internal UUID for deduplication
    role: MessageRole;
    content: string;
    createdAt?: string;
    personaId?: string; // Which persona said this message
    personaName?: string; // Persona's name for context
    discordUsername?: string; // Discord username for disambiguation when persona name matches personality name
  }[];
}

/**
 * Slash command definition
 */
export interface Command {
  data: SlashCommandBuilder;
  category?: string;

  /**
   * Execute slash command
   * Note: ModalSubmitInteraction support is for backwards compatibility.
   * New commands should use handleModal instead.
   */
  execute: (
    interaction: ChatInputCommandInteraction | ModalSubmitInteraction,
    ...args: unknown[]
  ) => Promise<void>;

  /** Optional autocomplete handler for commands with autocomplete options */
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;

  /** Optional select menu handler for commands with select menus */
  handleSelectMenu?: (interaction: StringSelectMenuInteraction) => Promise<void>;

  /** Optional button handler for commands with buttons */
  handleButton?: (interaction: ButtonInteraction) => Promise<void>;

  /** Optional modal handler for commands with modals */
  handleModal?: (interaction: ModalSubmitInteraction) => Promise<void>;

  /**
   * Additional customId prefixes this command handles.
   * The command name is automatically registered as a prefix.
   * Use this for sub-features with different prefixes (e.g., 'admin-settings').
   */
  componentPrefixes?: string[];
}
