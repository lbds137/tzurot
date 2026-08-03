/**
 * Bot Client Types
 *
 * Type definitions for Discord bot client.
 */

import type {
  ModalSubmitInteraction,
  AutocompleteInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  SlashCommandBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  SlashCommandOptionsOnlyBuilder,
} from 'discord.js';
import { type TranscribeResponse } from '@tzurot/common-types/types/api-types';
import { type CrossChannelHistoryGroupEntry } from '@tzurot/common-types/types/schemas/message';
import {
  type LoadedPersonality,
  type RequestContext,
} from '@tzurot/common-types/types/schemas/personality';
import type { DeferralMode, SafeCommandContext } from './utils/commandContext/index.js';
import type { ContextMenuCommandDefinition } from './utils/defineCommand.js';

// Re-export shared API types
export type { LoadedPersonality, TranscribeResponse };

/**
 * Message context for AI generation
 * Bot-specific context that gets sent to api-gateway
 * Extends RequestContext from common-types with bot-specific messageContent field
 */
export interface MessageContext extends RequestContext {
  messageContent: string;
  crossChannelHistory?: CrossChannelHistoryGroupEntry[];
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
   * Optional: when unset, the dispatcher defaults to 'ephemeral'. The mode
   * determines which SafeCommandContext variant execute() receives.
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
   * Always receives a typed SafeCommandContext — the dispatcher creates the
   * variant matching the effective deferral mode before calling this.
   */
  execute: (context: SafeCommandContext) => Promise<void>;

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

/**
 * Loaded message context-menu command (definition + derived category).
 * Registered in CommandHandler's separate context-menu map — the slash
 * `Command` surfaces (autocomplete, component routing, deferral modes)
 * don't apply to it.
 */
export interface ContextMenuCommand extends ContextMenuCommandDefinition {
  /** Category derived from folder structure; root-level files have none. */
  category?: string;
}
