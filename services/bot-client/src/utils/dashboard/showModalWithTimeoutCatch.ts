/**
 * Show a Discord modal, catching the 10062 "Unknown interaction"
 * timeout when the 3-second budget blew before `showModal` reached the
 * Discord edge.
 *
 * Discord forbids `deferReply` before `showModal`, so any async work
 * before the modal show (Redis lookup, gateway fallback) eats into the
 * 3-second budget. Under load, the budget can blow and `showModal`
 * throws `DiscordAPIError(10062)`. Without this catch the user sees a
 * silent "Interaction Failed" with no diagnostic signal in logs.
 *
 * On 10062: log + send an ephemeral `followUp` with a retry message.
 * The followUp itself can also 10062 on a fully-dead interaction
 * token; that secondary failure is swallowed.
 *
 * On any other error: rethrow so the global handler can surface it.
 */

import {
  DiscordAPIError,
  MessageFlags,
  type ModalBuilder,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types';

const logger = createLogger('show-modal-with-timeout-catch');

export interface ShowModalDiagContext {
  /** Originating handler name, e.g. 'handleSelectMenu' / 'handleOpenEditorButton'. */
  source: string;
  /** Discord user id (safe to log). */
  userId: string;
  /** Entity id (e.g. character/persona id) for diagnostic context. */
  entityId: string;
  /** Section id being edited. */
  sectionId: string;
}

export async function showModalWithTimeoutCatch(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  modal: ModalBuilder,
  diagContext: ShowModalDiagContext,
  retryMessage: string
): Promise<void> {
  try {
    await interaction.showModal(modal);
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 10062) {
      logger.warn(diagContext, 'showModal exceeded 3-second window (10062)');
      try {
        await interaction.followUp({
          content: retryMessage,
          flags: MessageFlags.Ephemeral,
        });
      } catch (followUpErr) {
        // Swallow only 10062 (the expected fully-dead-token case where
        // even followUp fails). Anything else (network partition, rate
        // limit, unexpected Discord error) is genuinely unexpected — log
        // as warn so it surfaces in observability without propagating to
        // the outer CommandHandler catch (which would re-log + re-attempt).
        if (!(followUpErr instanceof DiscordAPIError && followUpErr.code === 10062)) {
          logger.warn(
            { ...diagContext, err: followUpErr },
            'followUp after 10062 failed with unexpected error'
          );
        }
      }
      return;
    }
    throw error;
  }
}
