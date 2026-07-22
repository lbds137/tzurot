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
  type MessageContextMenuCommandInteraction,
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
  | MessageContextMenuCommandInteraction
  | StringSelectMenuInteraction
  | ModalSubmitInteraction;

/**
 * Component/modal interactions that can be acked with `deferUpdate` — the subset
 * of `RepliableInteraction` excluding `ChatInputCommandInteraction` and
 * `MessageContextMenuCommandInteraction` (application commands defer via
 * `deferReply`, never `deferUpdate`).
 */
export type DeferUpdatableInteraction =
  ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction;

export type AckMethod = 'editReply' | 'followUp' | 'reply';

/**
 * Which defer a handler performed. `deferUpdate` and `deferReply` both leave
 * `deferred = true` / `replied = false`, and discord.js exposes no flag telling
 * them apart — yet the delivery method must differ: `editReply` fills a
 * `deferReply` "Thinking…" placeholder, but CLOBBERS the component message a
 * `deferUpdate` left in place. The ack wrappers stamp the kind so the delivery
 * helpers pick correctly without the caller having to remember.
 */
export type DeferKind = 'update' | 'reply';

/**
 * Per-interaction defer-kind stamp, set by {@link ackUpdate} / {@link ackDeferReply}.
 * A WeakMap so it neither mutates the discord.js object nor leaks (an entry GCs
 * with its interaction). An UNSTAMPED interaction reads as `undefined`, and the
 * matrix keeps its historical behavior (`deferred → editReply`) — so nothing off
 * the `deferUpdate` path changes.
 */
const deferKindByInteraction = new WeakMap<RepliableInteraction, DeferKind>();

/**
 * Ack a component interaction with `deferUpdate` (no new message — the component
 * message stays) AND record that kind, so a later `replySpec`/`replyContent`
 * follows up ephemerally instead of clobbering the message. Use this in place of
 * a raw `interaction.deferUpdate()` — the `@tzurot/no-raw-defer-update` rule
 * enforces it, which is what keeps the stamp reliably present.
 */
export async function ackUpdate(interaction: DeferUpdatableInteraction): Promise<void> {
  await interaction.deferUpdate();
  deferKindByInteraction.set(interaction, 'update');
}

/**
 * Ack with `deferReply` and record the kind. Optional to adopt — an unstamped
 * deferred interaction already resolves to `editReply` (the correct
 * fill-the-placeholder behavior) — but explicit stamping keeps the two ack
 * paths symmetric.
 */
export async function ackDeferReply(
  interaction: RepliableInteraction,
  opts: { ephemeral?: boolean } = {}
): Promise<void> {
  await interaction.deferReply(opts.ephemeral === true ? { flags: MessageFlags.Ephemeral } : {});
  deferKindByInteraction.set(interaction, 'reply');
}

/** Read the recorded defer kind for an interaction (undefined if unstamped). */
export function deferKindOf(interaction: RepliableInteraction): DeferKind | undefined {
  return deferKindByInteraction.get(interaction);
}

/**
 * Pure ack matrix — unit-testable without discord.js mocks.
 *
 * | deferred | replied | deferKind | method    | why                                    |
 * |----------|---------|-----------|-----------|----------------------------------------|
 * | true     | false   | 'update'  | followUp  | component message stays; don't clobber |
 * | true     | false   | else      | editReply | fill the deferReply placeholder        |
 * | *        | true    | *         | followUp  | original reply stands; add a follow-up |
 * | false    | false   | *         | reply     | fresh interaction                      |
 */
export function ackMethodFor(state: {
  deferred: boolean;
  replied: boolean;
  deferKind?: DeferKind;
}): AckMethod {
  if (state.deferred && !state.replied) {
    // A deferUpdate left the component message in place — editReply would
    // overwrite it, so deliver as an ephemeral followUp instead.
    return state.deferKind === 'update' ? 'followUp' : 'editReply';
  }
  if (state.replied) {
    return 'followUp';
  }
  return 'reply';
}

/**
 * Deliver rendered content to an interaction, selecting the correct ack
 * method for its current state. followUp/reply branches are always ephemeral;
 * editReply inherits the deferral's visibility.
 *
 * PRECONDITION (deferred path): callers taking `deferred && !replied` must
 * have deferred ephemerally when the content is an error — `editReply`
 * inherits the deferral's flags, so a non-ephemeral deferral exposes the
 * content publicly. That misuse emits a runtime `warn` (it can't be prevented
 * here — the deferral already happened — but it won't pass silently).
 */
export async function replyContent(
  interaction: RepliableInteraction,
  content: string
): Promise<void> {
  const method = ackMethodFor({
    deferred: interaction.deferred,
    replied: interaction.replied,
    deferKind: deferKindByInteraction.get(interaction),
  });

  switch (method) {
    case 'editReply':
      if (interaction.ephemeral === false) {
        logger.warn(
          { interactionId: interaction.id },
          'Catalog reply took the deferred path on a non-ephemeral interaction; content will be publicly visible. Defer with MessageFlags.Ephemeral.'
        );
      }
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
 * Deliver a MessageSpec to an interaction (render + ack-state-adaptive send).
 * THE reply path for catalog messages — safe after ANY ack: when the handler
 * acked via {@link ackUpdate}, the stamp routes this to an ephemeral followUp
 * instead of a message-clobbering editReply. (Pre-stamp, this required calling
 * {@link followUpSpec} by hand after a deferUpdate.)
 */
export async function replySpec(
  interaction: RepliableInteraction,
  spec: MessageSpec,
  opts: RenderOptions = {}
): Promise<void> {
  await replyContent(interaction, renderSpec(spec, opts));
}

/**
 * Explicit ephemeral follow-up delivery. LEGACY: now that {@link ackUpdate}
 * stamps the defer kind, {@link replySpec} auto-selects followUp after a
 * deferUpdate, so new code can just use `replySpec`. Kept for the existing call
 * sites and for the rare handler that wants to force a followUp regardless of
 * ack state.
 */
export async function followUpSpec(
  interaction: RepliableInteraction,
  spec: MessageSpec,
  opts: RenderOptions = {}
): Promise<void> {
  await interaction.followUp({ content: renderSpec(spec, opts), flags: MessageFlags.Ephemeral });
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
