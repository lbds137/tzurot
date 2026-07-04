import {
  MessageFlags,
  type ButtonInteraction,
  type StringSelectMenuInteraction,
  type ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('replyError');

/**
 * Reply with an ephemeral error, adapting to the interaction's ack state.
 *
 * Accepts any component-style interaction that shares the
 * deferred/replied/reply/editReply/followUp surface — button, string
 * select menu, and modal submit (their ack handling is identical).
 *
 * Three states map to three response APIs:
 * - `deferred && !replied` (caller did `deferReply`, hasn't sent the
 *   actual response yet) → `editReply` fills the deferred slot. This
 *   replaces the "Thinking…" loading indicator with the error message
 *   instead of leaving the indicator dangling + spawning a separate
 *   followUp.
 * - `replied` (caller already sent a response) → `followUp` for an
 *   additional ephemeral message.
 * - fresh (neither deferred nor replied) → `reply`.
 *
 * **PRECONDITION (deferred path)**: Callers that take the
 * `deferred && !replied` path must have called `deferReply({ flags:
 * MessageFlags.Ephemeral })`. `editReply` inherits whatever flags were
 * set by `deferReply` — passing flags here has no effect. A caller that
 * defers without ephemeral and then hits this helper would expose the
 * error message publicly; that misuse emits a runtime `warn` (it can't be
 * prevented here — the deferral already happened — but it won't pass silently).
 *
 * The deferred slot's ephemeral flag is what makes the error message
 * private; the other two paths pass `flags: Ephemeral` explicitly.
 */
export async function replyError(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  content: string
): Promise<void> {
  if (interaction.deferred && !interaction.replied) {
    // editReply inherits the deferReply slot's flags. If the caller deferred
    // non-ephemerally, this error content is about to be publicly visible —
    // surface the precondition violation rather than leak it silently.
    if (interaction.ephemeral === false) {
      logger.warn(
        { interactionId: interaction.id },
        'replyError took the deferred path on a non-ephemeral interaction; error content will be publicly visible. Defer with MessageFlags.Ephemeral.'
      );
    }
    await interaction.editReply({ content });
  } else if (interaction.replied) {
    await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
  } else {
    await interaction.reply({ content, flags: MessageFlags.Ephemeral });
  }
}
