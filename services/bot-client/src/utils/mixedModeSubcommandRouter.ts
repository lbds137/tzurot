/**
 * Mixed-Mode Subcommand Router
 *
 * Router for commands with mixed subcommand deferral modes. Unlike the standard
 * subcommandContextRouter which expects all handlers to receive DeferredCommandContext,
 * this router supports handlers with different context types based on their deferral mode.
 *
 * @example
 * ```typescript
 * // Define handlers with their expected context types
 * const router = createMixedModeSubcommandRouter({
 *   deferred: {
 *     list: handleList,    // receives DeferredCommandContext
 *     remove: handleRemove,
 *     test: handleTest,
 *   },
 *   modal: {
 *     set: handleSet,      // receives ModalCommandContext
 *   },
 * }, { logger, logPrefix: '[Wallet]' });
 *
 * // In execute():
 * async function execute(context: SafeCommandContext): Promise<void> {
 *   await router(context);
 * }
 * ```
 */

import type { Logger } from 'pino';
import type {
  SafeCommandContext,
  DeferredCommandContext,
  ModalCommandContext,
} from './commandContext/types.js';

/**
 * Handler for deferred subcommands (receives DeferredCommandContext)
 */
export type DeferredSubcommandHandler = (context: DeferredCommandContext) => Promise<void>;

/**
 * Handler for modal subcommands (receives ModalCommandContext)
 */
export type ModalSubcommandHandler = (context: ModalCommandContext) => Promise<void>;

/**
 * Configuration for mixed-mode subcommand handlers
 */
export interface MixedModeHandlers {
  /** Handlers for subcommands that are deferred (ephemeral or public) */
  deferred?: Record<string, DeferredSubcommandHandler>;
  /** Handlers for subcommands that show modals */
  modal?: Record<string, ModalSubcommandHandler>;
}

/**
 * Options for the mixed-mode router
 */
export interface MixedModeRouterOptions {
  /** Logger instance for logging subcommand execution */
  logger?: Logger;
  /** Prefix for log messages (e.g., '[Wallet]') */
  logPrefix?: string;
}

/**
 * Creates a mixed-mode subcommand router that dispatches to handlers
 * with the appropriate context type.
 *
 * @param handlers - Handlers grouped by their expected context type
 * @param options - Optional logging configuration
 * @returns Router function that dispatches to the appropriate handler
 */
export function createMixedModeSubcommandRouter(
  handlers: MixedModeHandlers,
  options: MixedModeRouterOptions = {}
): (context: SafeCommandContext) => Promise<void> {
  const { logger, logPrefix } = options;

  // Build lookup maps for fast dispatch
  const deferredHandlers = handlers.deferred ?? {};
  const modalHandlers = handlers.modal ?? {};

  return async (context: SafeCommandContext): Promise<void> => {
    const subcommand = context.getSubcommand();

    // Log subcommand execution if logger provided
    if (logger !== undefined && logPrefix !== undefined) {
      logger.info({ subcommand, userId: context.user.id }, `${logPrefix} Executing subcommand`);
    }

    if (subcommand === null) {
      // No subcommand - try to respond appropriately based on context type
      if ('editReply' in context) {
        await (context as DeferredCommandContext).editReply({
          content: '❌ No subcommand specified',
        });
      } else if ('reply' in context) {
        await (context).reply({ content: '❌ No subcommand specified' });
      }
      return;
    }

    // Check deferred handlers first
    if (subcommand in deferredHandlers) {
      await deferredHandlers[subcommand](context as DeferredCommandContext);
      return;
    }

    // Check modal handlers
    if (subcommand in modalHandlers) {
      await modalHandlers[subcommand](context as ModalCommandContext);
      return;
    }

    // Unknown subcommand
    if ('editReply' in context) {
      await (context as DeferredCommandContext).editReply({ content: '❌ Unknown subcommand' });
    } else if ('reply' in context) {
      await (context).reply({ content: '❌ Unknown subcommand' });
    }
  };
}
