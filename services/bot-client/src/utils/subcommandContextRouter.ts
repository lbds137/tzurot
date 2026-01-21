/**
 * Subcommand Context Router Utility
 *
 * Context-aware version of subcommandRouter that works with SafeCommandContext
 * instead of raw ChatInputCommandInteraction. This enables compile-time
 * prevention of InteractionAlreadyReplied errors in subcommand handlers.
 *
 * @see subcommandRouter.ts for the legacy interaction-based router
 * @see commandContext/types.ts for context type definitions
 */

import type { Logger } from 'pino';
import type { DeferredCommandContext, SafeCommandContext } from './commandContext/types.js';

/**
 * Handler function signature for context-aware subcommands.
 * Receives DeferredCommandContext which does NOT have deferReply().
 */
export type SubcommandContextHandler = (context: DeferredCommandContext) => Promise<void>;

/**
 * Map of subcommand names to their context-aware handlers
 */
export type SubcommandContextMap = Record<string, SubcommandContextHandler>;

/**
 * Options for the context-aware subcommand router
 */
export interface ContextRouterOptions {
  /** Logger instance for logging subcommand execution */
  logger?: Logger;
  /** Prefix for log messages (e.g., '[Channel]') */
  logPrefix?: string;
}

/**
 * Creates a context-aware subcommand router that dispatches to handlers.
 *
 * Unlike the legacy createSubcommandRouter, this passes DeferredCommandContext
 * to handlers, which does NOT have deferReply() - preventing accidental
 * double-deferral at compile time.
 *
 * @example
 * ```typescript
 * const router = createSubcommandContextRouter({
 *   activate: handleActivate,  // receives DeferredCommandContext
 *   deactivate: handleDeactivate,
 *   list: handleList,
 * }, { logger, logPrefix: '[Channel]' });
 *
 * // In execute():
 * async function execute(ctx: SafeCommandContext): Promise<void> {
 *   const context = ctx as DeferredCommandContext;
 *   await router(context);
 * }
 * ```
 *
 * @param handlers - Map of subcommand names to context-aware handler functions
 * @param options - Optional logging configuration
 * @returns Router function that dispatches to the appropriate handler
 */
export function createSubcommandContextRouter(
  handlers: SubcommandContextMap,
  options: ContextRouterOptions = {}
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

/**
 * Type guard to narrow SafeCommandContext to DeferredCommandContext.
 * Use when a command with deferralMode receives context and needs to pass
 * it to a context-aware router.
 */
export function asDeferredContext(ctx: SafeCommandContext): DeferredCommandContext {
  return ctx as DeferredCommandContext;
}
