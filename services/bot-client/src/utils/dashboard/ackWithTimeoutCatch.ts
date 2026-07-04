/**
 * Run an interaction's FIRST acknowledgment (reply / update / showModal),
 * catching the 10062 "Unknown interaction" timeout when the 3-second budget
 * blew before the ack reached the Discord edge.
 *
 * Handlers that must do async work (Redis session lookup, gateway fetch)
 * BEFORE deciding how to respond eat into the 3-second budget — and some
 * response shapes (showModal, error replies on branches that normally lead
 * to showModal) cannot be preceded by deferUpdate. Under load, the budget
 * can blow and the ack throws `DiscordAPIError(10062)`. Without this catch
 * the user sees a silent "Interaction Failed" with no diagnostic signal in
 * logs.
 *
 * On 10062: log + send an ephemeral `followUp` with the provided message.
 * The followUp goes via the webhook endpoint, whose token outlives the
 * 3-second initial-response window — so it usually lands (after Discord
 * shows "Application did not respond"). A followUp on a fully-dead token
 * also 10062s; that secondary failure is swallowed.
 *
 * On any other error: rethrow so the global handler can surface it.
 */

import {
  DiscordAPIError,
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('ack-with-timeout-catch');

export interface InteractionAckDiagContext {
  /** Originating handler name, e.g. 'handleSelectMenu' / 'handleOpenEditorButton'. */
  source: string;
  /** Discord user id (safe to log). */
  userId: string;
  /** Entity id (e.g. character/persona/memory id) for diagnostic context. */
  entityId: string;
  /** Section id being edited. */
  sectionId: string;
}

type AckableInteraction =
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction
  | ChatInputCommandInteraction;

export async function ackWithTimeoutCatch(
  interaction: AckableInteraction,
  ack: () => Promise<unknown>,
  diagContext: InteractionAckDiagContext,
  timeoutMessage: string
): Promise<void> {
  try {
    await ack();
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === 10062) {
      logger.warn(diagContext, 'Interaction ack exceeded 3-second window (10062)');
      try {
        await interaction.followUp({
          content: timeoutMessage,
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
