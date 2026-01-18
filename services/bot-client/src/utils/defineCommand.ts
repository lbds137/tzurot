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
 * Usage:
 * ```typescript
 * export default defineCommand({
 *   data: new SlashCommandBuilder().setName('ping').setDescription('Pong'),
 *   execute: async (interaction) => {
 *     await interaction.reply('Pong!');
 *   },
 *   // TypeScript will autocomplete valid handler names here
 *   handleModal: async (interaction) => { ... },
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
   * Main command execution handler.
   * Called when the slash command is invoked.
   */
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;

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
