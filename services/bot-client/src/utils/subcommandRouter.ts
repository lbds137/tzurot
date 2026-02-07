/**
 * Subcommand Router Utility
 *
 * Provides a declarative way to route slash command subcommands to handlers.
 * Eliminates repetitive switch statements and centralizes error handling.
 *
 * Benefits:
 * - DRY: No duplicate switch/default blocks
 * - Testable: Easy to mock and test individual handlers
 * - Type-safe: TypeScript ensures handler signatures match
 * - Consistent: All commands handle unknown subcommands the same way
 */

import { MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction, ModalSubmitInteraction } from 'discord.js';
import type { Logger } from 'pino';

/**
 * Handler function signature for subcommands
 */
type SubcommandHandler<T extends ChatInputCommandInteraction = ChatInputCommandInteraction> = (
  interaction: T
) => Promise<void>;

/**
 * Map of subcommand names to their handlers
 */
type SubcommandMap<T extends ChatInputCommandInteraction = ChatInputCommandInteraction> = Record<
  string,
  SubcommandHandler<T>
>;

/**
 * Options for the subcommand router
 */
interface RouterOptions {
  /** Logger instance for logging subcommand execution */
  logger?: Logger;
  /** Prefix for log messages (e.g., '[Wallet]') */
  logPrefix?: string;
}

/**
 * Creates a subcommand router that dispatches to the appropriate handler.
 *
 * Replaces repetitive switch statements with a declarative map-based approach.
 *
 * @example
 * ```typescript
 * const router = createSubcommandRouter({
 *   set: handleSetKey,
 *   list: handleListKeys,
 *   remove: handleRemoveKey,
 * }, { logger, logPrefix: '[Wallet]' });
 *
 * // In execute():
 * await router(interaction);
 * ```
 *
 * @param handlers - Map of subcommand names to handler functions
 * @param options - Optional logging configuration
 * @returns Router function that dispatches to the appropriate handler
 */
export function createSubcommandRouter<
  T extends ChatInputCommandInteraction = ChatInputCommandInteraction,
>(handlers: SubcommandMap<T>, options: RouterOptions = {}): SubcommandHandler<T> {
  const { logger, logPrefix } = options;

  return async (interaction: T): Promise<void> => {
    const subcommand = interaction.options.getSubcommand();

    // Log subcommand execution if logger provided
    if (logger !== undefined && logPrefix !== undefined) {
      logger.info({ subcommand, userId: interaction.user.id }, `${logPrefix} Executing subcommand`);
    }

    const handler = handlers[subcommand];

    if (handler !== undefined) {
      await handler(interaction);
    } else {
      await replyUnknownSubcommand(interaction);
    }
  };
}

/**
 * Reply with a consistent "unknown subcommand" error.
 * Exported for use in modal routing or custom scenarios.
 */
export async function replyUnknownSubcommand(
  interaction: ChatInputCommandInteraction | ModalSubmitInteraction
): Promise<void> {
  await interaction.reply({
    content: '\u274c Unknown subcommand',
    flags: MessageFlags.Ephemeral,
  });
}

/**
 * Reply with a consistent "unknown action" error for modals.
 */
export async function replyUnknownAction(interaction: ModalSubmitInteraction): Promise<void> {
  await interaction.reply({
    content: '\u274c Unknown action',
    flags: MessageFlags.Ephemeral,
  });
}

// ============================================================================
// Typed Context Routers (for SafeCommandContext pattern)
// ============================================================================

import type { DeferredCommandContext } from './commandContext/types.js';

/**
 * Handler function signature for subcommands using typed context
 */
type TypedSubcommandHandler = (context: DeferredCommandContext) => Promise<void>;

/**
 * Map of subcommand names to typed handlers
 */
type TypedSubcommandMap = Record<string, TypedSubcommandHandler>;

/**
 * Creates a subcommand router for commands using DeferredCommandContext.
 *
 * For commands where all subcommands share the same deferral mode, this provides
 * type-safe routing with the proper context type.
 *
 * @example
 * ```typescript
 * const router = createTypedSubcommandRouter({
 *   stats: handleStats,
 *   list: handleList,
 *   search: handleSearch,
 * }, { logger, logPrefix: '[Memory]' });
 *
 * // In execute():
 * await router(context);
 * ```
 */
export function createTypedSubcommandRouter(
  handlers: TypedSubcommandMap,
  options: RouterOptions = {}
): (context: DeferredCommandContext) => Promise<void> {
  const { logger, logPrefix } = options;

  return async (context: DeferredCommandContext): Promise<void> => {
    const subcommand = context.getSubcommand();

    // Log subcommand execution if logger provided
    if (logger !== undefined && logPrefix !== undefined) {
      logger.info({ subcommand, userId: context.user.id }, `${logPrefix} Executing subcommand`);
    }

    if (subcommand === null) {
      await context.editReply({ content: '❌ No subcommand specified' });
      return;
    }

    const handler = handlers[subcommand];

    if (handler !== undefined) {
      await handler(context);
    } else {
      await context.editReply({ content: '❌ Unknown subcommand' });
    }
  };
}
