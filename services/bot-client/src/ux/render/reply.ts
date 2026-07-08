/**
 * Ack-state-adaptive spec delivery — THE reply path for catalog messages.
 *
 * Absorbs the ack-selection logic that previously lived twice with a drift
 * between the copies:
 *   - `utils/dashboard/replyError.ts` (3-branch: deferred→editReply,
 *     replied→followUp, fresh→reply) — correct.
 *   - `CommandHandler.sendErrorReply` (2-branch: replied||deferred→followUp)
 *     — LATENT BUG: a deferred-but-unreplied interaction got a followUp,
 *     stranding the "Thinking…" placeholder forever. The unified path routes
 *     that case to editReply (fills the placeholder), which is the fix.
 */

import {
  MessageFlags,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import type { MessageSpec } from '../catalog/types.js';
import { renderSpec, type RenderOptions } from './render.js';

const logger = createLogger('ux-reply');

/** Every repliable interaction shape the bot handles. */
export type RepliableInteraction =
  | ChatInputCommandInteraction
  | ButtonInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

export type AckMethod = 'editReply' | 'followUp' | 'reply';

/**
 * Pure ack matrix — unit-testable without discord.js mocks.
 *
 * | deferred | replied | method    | why                                    |
 * |----------|---------|-----------|----------------------------------------|
 * | true     | false   | editReply | fill the deferral placeholder          |
 * | *        | true    | followUp  | original reply stands; add a follow-up |
 * | false    | false   | reply     | fresh interaction                      |
 */
export function ackMethodFor(state: { deferred: boolean; replied: boolean }): AckMethod {
  if (state.deferred && !state.replied) {
    return 'editReply';
  }
  if (state.replied) {
    return 'followUp';
  }
  return 'reply';
}

/**
 * Deliver a MessageSpec to an interaction, selecting the correct ack method
 * for its current state. followUp/reply branches are always ephemeral;
 * editReply inherits the deferral's visibility (callers of deferred flows own
 * that choice — a public deferral getting a public error is deliberate).
 */
export async function replySpec(
  interaction: RepliableInteraction,
  spec: MessageSpec,
  opts: RenderOptions = {}
): Promise<void> {
  const content = renderSpec(spec, opts);
  const method = ackMethodFor({ deferred: interaction.deferred, replied: interaction.replied });

  switch (method) {
    case 'editReply':
      await interaction.editReply({ content });
      return;
    case 'followUp':
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral });
      return;
    case 'reply':
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
      return;
  }
}

/**
 * Best-effort variant for catch-all paths: delivery failure is logged, never
 * rethrown (the caller is already handling an error; a reply failure must not
 * mask it).
 */
export async function replySpecSafe(
  interaction: RepliableInteraction,
  spec: MessageSpec,
  opts: RenderOptions & {
    /** Correlation fields for the failure log (commandName, customId, …). */
    logContext?: Record<string, unknown>;
  } = {}
): Promise<void> {
  try {
    await replySpec(interaction, spec, opts);
  } catch (error) {
    // warn, not error: the common cause is an expired/already-acked
    // interaction on a catch-all path — real, but not actionable per-event
    // (and error-level would pollute post-deploy level-50 scans).
    logger.warn({ err: error, ...opts.logContext }, 'Failed to deliver catalog message');
  }
}
