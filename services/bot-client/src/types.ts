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
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import type { GenerateResponse, LoadedPersonality, RequestContext } from '@tzurot/common-types';
import { MessageRole } from '@tzurot/common-types';
import type { DeferralMode, SafeCommandContext } from './utils/commandContext/index.js';

// Re-export shared API types
export type { GenerateResponse, LoadedPersonality };

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
 * Slash command definition (loaded command with category)
 *
 * This extends CommandDefinition with the category field that is
 * injected by CommandHandler based on directory structure.
 *
 * @see CommandDefinition in utils/defineCommand.ts for the base definition
 */
export interface Command {
  data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;

  /** Category derived from folder structure (e.g., 'Memory', 'Character') */
  category?: string;

  /**
   * How this command's interaction should be deferred.
   *
   * - 'ephemeral': Deferred with ephemeral: true (default - only user sees "thinking")
   * - 'public': Deferred with ephemeral: false (everyone sees "thinking")
   * - 'modal': Not deferred - command shows a modal first
   * - 'none': Not deferred - command handles response timing itself
   *
   * When set, execute() receives a typed SafeCommandContext.
   * When not set (legacy mode), execute() receives raw ChatInputCommandInteraction.
   */
  deferralMode?: DeferralMode;

  /**
   * Per-subcommand deferral mode overrides.
   *
   * Use for commands with mixed subcommand requirements (e.g., some show modals,
   * others need deferral). Key is subcommand name or 'group subcommand' for groups.
   */
  subcommandDeferralModes?: Record<string, DeferralMode>;

  /**
   * Main command execution handler.
   *
   * If deferralMode is set, receives a typed SafeCommandContext.
   * Otherwise, receives raw ChatInputCommandInteraction (legacy mode).
   */
  execute:
    | ((interaction: ChatInputCommandInteraction) => Promise<void>)
    | ((context: SafeCommandContext) => Promise<void>);

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
