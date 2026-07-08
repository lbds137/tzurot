/**
 * Legacy ephemeral-error reply — now a thin delegate onto the unified
 * ack-state machinery in `ux/render/reply.ts` (`replyContent`), so there is
 * exactly ONE implementation of the deferred/replied/fresh ack matrix.
 *
 * TRANSITIONAL: new code should build a catalog intent and call `replySpec`
 * instead of hand-writing an error string for this helper — the remaining
 * call sites migrate with the outcome-honesty sweep.
 */

import type {
  ButtonInteraction,
  StringSelectMenuInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
import { replyContent } from '../../ux/render/reply.js';

/**
 * Reply with an ephemeral error, adapting to the interaction's ack state.
 * See `replyContent` for the ack matrix and the ephemeral-deferral
 * precondition (misuse warns at runtime).
 */
export async function replyError(
  interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction,
  content: string
): Promise<void> {
  await replyContent(interaction, content);
}
