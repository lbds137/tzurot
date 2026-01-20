/**
 * Safe Interaction Wrapper
 *
 * Provides a wrapper that automatically converts reply() calls to editReply()
 * when an interaction has already been deferred. This prevents the
 * InteractionAlreadyReplied error that occurs when commands use reply()
 * after the top-level deferReply() in index.ts.
 *
 * BACKGROUND:
 * - Discord interactions must be responded to within 3 seconds
 * - We call deferReply() at the top level in index.ts to extend this to 15 minutes
 * - Once deferred, commands must use editReply() instead of reply()
 * - This wrapper makes commands work correctly regardless of which method they use
 *
 * @example
 * ```typescript
 * // In index.ts, after deferring:
 * const safeInteraction = wrapDeferredInteraction(interaction);
 * await commandHandler.handleInteraction(safeInteraction);
 *
 * // In command files, both of these now work correctly:
 * await interaction.reply({ content: 'Hello' });     // Auto-converted to editReply
 * await interaction.editReply({ content: 'Hello' }); // Works as normal
 * ```
 */

import {
  MessagePayload,
  type ChatInputCommandInteraction,
  type InteractionReplyOptions,
  type InteractionEditReplyOptions,
  type Message,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('SafeInteraction');

/**
 * Wraps a deferred ChatInputCommandInteraction to automatically convert
 * reply() calls to editReply() calls, and make deferReply() a no-op.
 *
 * This is a runtime safety mechanism that prevents InteractionAlreadyReplied
 * errors regardless of whether command authors use reply(), editReply(), or
 * redundantly call deferReply().
 *
 * @param interaction - The original interaction that has been deferred
 * @returns A proxied interaction where reply() calls are converted to editReply()
 *          and deferReply() calls become no-ops
 */
export function wrapDeferredInteraction(
  interaction: ChatInputCommandInteraction
): ChatInputCommandInteraction {
  // Create a proxy that intercepts method calls
  return new Proxy(interaction, {
    get(target, prop, receiver) {
      // Intercept deferReply() calls and make them no-ops (already deferred)
      if (prop === 'deferReply') {
        return (): void => {
          // Build full command name for logging
          const subcommand = target.options.getSubcommand(false);
          const subcommandGroup = target.options.getSubcommandGroup(false);
          let fullCommand = target.commandName;
          if (subcommandGroup !== null && subcommandGroup.length > 0) {
            fullCommand += ` ${subcommandGroup}`;
          }
          if (subcommand !== null && subcommand.length > 0) {
            fullCommand += ` ${subcommand}`;
          }

          logger.warn(
            { command: fullCommand },
            `[SafeInteraction] Command called deferReply() but interaction is already deferred - ignoring. ` +
              `FIX: Remove deferReply() call from /${fullCommand} (handled at top-level)`
          );

          // No-op: interaction is already deferred
        };
      }

      // Intercept reply() calls and convert to editReply()
      if (prop === 'reply') {
        return async (
          options: string | MessagePayload | InteractionReplyOptions
        ): Promise<Message> => {
          // Log a warning so we can identify commands that need fixing
          // Capture stack trace to show which file called reply()
          const stack = new Error().stack ?? '';
          const callerLine = stack.split('\n')[2]?.trim() ?? 'unknown';

          // Build full command name for easier identification
          const subcommand = target.options.getSubcommand(false);
          const subcommandGroup = target.options.getSubcommandGroup(false);
          let fullCommand = target.commandName;
          if (subcommandGroup !== null && subcommandGroup.length > 0) {
            fullCommand += ` ${subcommandGroup}`;
          }
          if (subcommand !== null && subcommand.length > 0) {
            fullCommand += ` ${subcommand}`;
          }

          logger.warn(
            { command: fullCommand, caller: callerLine },
            `[SafeInteraction] Command used reply() on deferred interaction - auto-converting to editReply(). ` +
              `FIX: Change interaction.reply() to interaction.editReply() in /${fullCommand}`
          );

          // Convert reply options to editReply options
          const editOptions = convertToEditReplyOptions(options);
          return target.editReply(editOptions);
        };
      }

      // For all other properties, return the original value
      // Use Reflect.get to properly handle getters and preserve 'this' binding
      const value: unknown = Reflect.get(target, prop, receiver);

      // If it's a function, bind it to the original target
      if (typeof value === 'function') {
        return (value as (...args: unknown[]) => unknown).bind(target);
      }

      return value;
    },
  });
}

/**
 * Converts InteractionReplyOptions to InteractionEditReplyOptions.
 *
 * The main difference is that editReply doesn't support the 'ephemeral' flag
 * (ephemerality is determined at deferReply time), so we just pass through
 * the other options.
 *
 * @param options - The reply options to convert
 * @returns Options compatible with editReply()
 */
function convertToEditReplyOptions(
  options: string | MessagePayload | InteractionReplyOptions
): string | MessagePayload | InteractionEditReplyOptions {
  // String options work for both
  if (typeof options === 'string') {
    return options;
  }

  // MessagePayload works for both
  if (options instanceof MessagePayload) {
    return options;
  }

  // For object options, editReply accepts most of the same properties
  // The 'flags' property (used for ephemeral) is already set by deferReply
  return options as InteractionEditReplyOptions;
}
