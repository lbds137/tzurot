/**
 * defineCommand - Type-safe command definition helper
 *
 * This helper enforces the command contract at compile-time. If you typo
 * a handler name (e.g., handleModalSubmit instead of handleModal), TypeScript
 * will catch it immediately.
 *
 * Background: We had a bug where a command exported `handleModalSubmit` but
 * CommandHandler looked for `handleModal`. The typo was silently ignored,
 * causing cryptic runtime errors. This pattern prevents that class of bug.
 *
 * Usage (legacy - receives raw interaction):
 * ```typescript
 * export default defineCommand({
 *   data: new SlashCommandBuilder().setName('ping').setDescription('Pong'),
 *   execute: async (interaction) => {
 *     await interaction.editReply('Pong!');
 *   },
 * });
 * ```
 *
 * Usage (new - receives typed context, compile-time safe):
 * ```typescript
 * export default defineCommand({
 *   data: new SlashCommandBuilder().setName('ping').setDescription('Pong'),
 *   deferralMode: 'ephemeral', // Determines context type
 *   execute: async (context) => {
 *     // context.deferReply() would be a TypeScript ERROR here
 *     await context.editReply('Pong!');
 *   },
 * });
 * ```
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
import type { DeferralMode, SafeCommandContext } from './commandContext/index.js';

// Re-export context types for convenience
export type { DeferralMode, SafeCommandContext } from './commandContext/index.js';
export type {
  DeferredCommandContext,
  ModalCommandContext,
  ManualCommandContext,
} from './commandContext/index.js';

/**
 * Command definition that can be passed to defineCommand.
 *
 * This is the "contract" between command modules and CommandHandler.
 * All properties are explicitly defined - no extra properties allowed.
 */
export interface CommandDefinition {
  /** Slash command builder with name, description, and options */
  data:
    | SlashCommandBuilder
    | SlashCommandSubcommandsOnlyBuilder
    | SlashCommandOptionsOnlyBuilder
    | Omit<SlashCommandBuilder, 'addSubcommand' | 'addSubcommandGroup'>;

  /**
   * How this command's interaction should be deferred.
   *
   * - 'ephemeral': Deferred with ephemeral: true (default - only user sees "thinking")
   * - 'public': Deferred with ephemeral: false (everyone sees "thinking")
   * - 'modal': Not deferred - command shows a modal first
   * - 'none': Not deferred - command handles response timing itself
   *
   * When set, the command's execute() receives a typed SafeCommandContext
   * instead of raw ChatInputCommandInteraction. This enables compile-time
   * prevention of InteractionAlreadyReplied errors.
   *
   * For commands with mixed subcommand modes, use `subcommandDeferralModes`
   * to override specific subcommands.
   */
  deferralMode?: DeferralMode;

  /**
   * Per-subcommand deferral mode overrides.
   *
   * Use this for commands where different subcommands need different deferral
   * behavior. The key is either the subcommand name (e.g., 'set') or the full
   * path for subcommand groups (e.g., 'profile create').
   *
   * @example
   * ```typescript
   * defineCommand({
   *   deferralMode: 'ephemeral', // Default for most subcommands
   *   subcommandDeferralModes: {
   *     'set': 'modal', // /wallet set shows a modal
   *   },
   *   execute: async (context) => {
   *     // Context type varies based on which subcommand was invoked
   *     // Framework handles this automatically
   *   },
   * });
   * ```
   */
  subcommandDeferralModes?: Record<string, DeferralMode>;

  /**
   * Main command execution handler.
   * Called when the slash command is invoked.
   *
   * If deferralMode is set, receives a typed SafeCommandContext.
   * Otherwise, receives raw ChatInputCommandInteraction (legacy mode).
   */
  execute:
    | ((interaction: ChatInputCommandInteraction) => Promise<void>)
    | ((context: SafeCommandContext) => Promise<void>);

  /**
   * Autocomplete handler for commands with autocomplete options.
   * Called when user is typing in an autocomplete field.
   */
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;

  /**
   * Button interaction handler.
   * Called when a button with matching customId prefix is clicked.
   */
  handleButton?: (interaction: ButtonInteraction) => Promise<void>;

  /**
   * Modal submission handler.
   * Called when a modal with matching customId prefix is submitted.
   */
  handleModal?: (interaction: ModalSubmitInteraction) => Promise<void>;

  /**
   * Select menu interaction handler.
   * Called when a select menu with matching customId prefix is used.
   */
  handleSelectMenu?: (interaction: StringSelectMenuInteraction) => Promise<void>;

  /**
   * Additional customId prefixes this command handles.
   * The command name is automatically registered as a prefix.
   * Use this for sub-features with different prefixes.
   */
  componentPrefixes?: string[];
}

/**
 * All valid keys that can be exported by a command module.
 * Used by CommandHandler for runtime validation.
 */
export const VALID_COMMAND_KEYS: readonly (keyof CommandDefinition)[] = [
  'data',
  'deferralMode',
  'subcommandDeferralModes',
  'execute',
  'autocomplete',
  'handleButton',
  'handleModal',
  'handleSelectMenu',
  'componentPrefixes',
] as const;

/**
 * Define a command with type-safe properties.
 *
 * This is an identity function that enforces the CommandDefinition type.
 * If you pass an object with unknown properties (like a typo'd handler name),
 * TypeScript will produce a compile-time error.
 *
 * @param definition - The command definition object
 * @returns The same object, typed as CommandDefinition
 */
export function defineCommand<T extends CommandDefinition>(definition: T): T {
  return definition;
}
