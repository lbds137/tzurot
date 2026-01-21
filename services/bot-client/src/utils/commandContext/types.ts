/**
 * Command Context Types
 *
 * Type-safe context objects for slash commands. Commands receive a typed context
 * that only exposes the methods appropriate for their deferral mode.
 *
 * Key insight: By giving DeferredCommandContext NO deferReply() method,
 * attempting to call it becomes a compile-time error, not a runtime warning.
 *
 * @example
 * // In a command with deferralMode: 'ephemeral'
 * execute: async (context: DeferredCommandContext) => {
 *   // This is a TypeScript ERROR - deferReply doesn't exist on this type
 *   await context.deferReply({ ephemeral: true }); // ❌ Property 'deferReply' does not exist
 *
 *   // This is correct - use editReply for deferred commands
 *   await context.editReply('Done!'); // ✅
 * }
 */

import type {
  ChatInputCommandInteraction,
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  InteractionResponse,
  InteractionCallbackResponse,
  Message,
  ModalBuilder,
  User,
  Guild,
  GuildMember,
  TextBasedChannel,
  CommandInteractionOption,
} from 'discord.js';

/**
 * Deferral mode for commands - determines how/if interaction is deferred
 *
 * - 'ephemeral': Deferred with ephemeral: true (default, response only visible to user)
 * - 'public': Deferred with ephemeral: false (response visible to everyone)
 * - 'modal': Not deferred - command will show a modal first
 * - 'none': Not deferred - command handles deferral itself (advanced use case)
 */
export type DeferralMode = 'ephemeral' | 'public' | 'modal' | 'none';

/**
 * Base context with common properties shared by all context types.
 *
 * These are read-only accessors and option helpers that don't modify
 * the interaction state.
 */
interface BaseCommandContext {
  /** The original interaction (for advanced use cases that need full Discord.js API) */
  readonly interaction: ChatInputCommandInteraction;

  /** The user who invoked the command */
  readonly user: User;

  /** The guild (null in DMs) */
  readonly guild: Guild | null;

  /** The guild member (null in DMs) */
  readonly member: GuildMember | null;

  /** The channel where the command was invoked */
  readonly channel: TextBasedChannel | null;

  /** The command name */
  readonly commandName: string;

  /**
   * Get an option value by name.
   * Returns null if the option wasn't provided.
   */
  getOption: <T = CommandInteractionOption['value']>(name: string) => T | null;

  /**
   * Get a required option value by name.
   * Throws if the option wasn't provided.
   */
  getRequiredOption: <T = CommandInteractionOption['value']>(name: string) => T;

  /**
   * Get the subcommand name, if any.
   * Returns null if no subcommand was used.
   */
  getSubcommand: () => string | null;

  /**
   * Get the subcommand group name, if any.
   * Returns null if no subcommand group was used.
   */
  getSubcommandGroup: () => string | null;
}

/**
 * Context for deferred commands (ephemeral or public).
 *
 * IMPORTANT: This type intentionally does NOT have a deferReply() method.
 * The framework has already called deferReply() before execute() is called.
 * Use editReply() to send/update the response.
 *
 * @example
 * execute: async (context: DeferredCommandContext) => {
 *   // Do some async work...
 *   await someAsyncOperation();
 *
 *   // Send the response
 *   await context.editReply('Operation complete!');
 * }
 */
export interface DeferredCommandContext extends BaseCommandContext {
  /**
   * Edit the deferred reply.
   * This is the primary way to respond in deferred commands.
   */
  editReply: (options: string | InteractionEditReplyOptions) => Promise<Message>;

  /**
   * Send a follow-up message after the initial reply.
   * Useful for sending additional information.
   */
  followUp: (options: string | InteractionReplyOptions) => Promise<Message>;

  /**
   * Delete the deferred reply.
   * Use sparingly - usually better to edit with a completion message.
   */
  deleteReply: () => Promise<void>;

  /**
   * Whether the reply is ephemeral (only visible to the user).
   * Determined by the command's deferralMode.
   */
  readonly isEphemeral: boolean;
}

/**
 * Context for modal commands.
 *
 * Commands with deferralMode: 'modal' receive this context.
 * The framework does NOT call deferReply() - the command must
 * show a modal to respond within 3 seconds.
 *
 * This type HAS deferReply() because modal commands may need it
 * after showing the modal and receiving the submission.
 *
 * @example
 * execute: async (context: ModalCommandContext) => {
 *   // Show modal immediately (must be within 3 seconds)
 *   await context.showModal(myModal);
 *
 *   // Modal submission is handled by handleModal(), not here
 * }
 */
export interface ModalCommandContext extends BaseCommandContext {
  /**
   * Show a modal to the user.
   * Must be called within 3 seconds of the interaction.
   */
  showModal: (modal: ModalBuilder) => Promise<InteractionCallbackResponse>;

  /**
   * Reply directly with a message (instead of showing modal).
   * Use for error cases where you can't show the modal.
   */
  reply: (options: string | InteractionReplyOptions) => Promise<InteractionResponse>;

  /**
   * Defer the reply.
   * Only use this in error cases where you can't show the modal
   * and need to do async work before responding.
   */
  deferReply: (options?: { ephemeral?: boolean }) => Promise<InteractionResponse>;
}

/**
 * Context for commands with no automatic deferral.
 *
 * Commands with deferralMode: 'none' receive this context.
 * The command is responsible for calling either reply() or
 * deferReply() within 3 seconds.
 *
 * Use sparingly - prefer 'ephemeral', 'public', or 'modal'.
 */
export interface ManualCommandContext extends BaseCommandContext {
  /** Reply immediately with a message */
  reply: (options: string | InteractionReplyOptions) => Promise<InteractionResponse>;

  /** Defer the reply for later editing */
  deferReply: (options?: { ephemeral?: boolean }) => Promise<InteractionResponse>;

  /** Edit the deferred reply (only valid after deferReply) */
  editReply: (options: string | InteractionEditReplyOptions) => Promise<Message>;

  /** Show a modal to the user */
  showModal: (modal: ModalBuilder) => Promise<InteractionCallbackResponse>;
}

/**
 * Union of all command context types.
 * Used when the exact context type isn't known at compile time.
 */
export type SafeCommandContext =
  | DeferredCommandContext
  | ModalCommandContext
  | ManualCommandContext;
