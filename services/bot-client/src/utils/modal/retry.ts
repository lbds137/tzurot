/**
 * Preserve-input-on-validation-failure (design-system D15 affordance).
 *
 * When a modal submission fails app-side validation, the modal is already
 * closed and Discord offers no way to reopen it prefilled — historically
 * the user's input was simply lost. This module standardizes the recovery:
 *
 *   1. The submit handler attaches a "Try again" button to its error reply
 *      (`buildModalRetryRow`) and stashes the submitted values in a
 *      dashboard session keyed by that reply's message id
 *      (`stashModalRetry`) — values can be kilobytes, so they live in
 *      Redis, never in the customId.
 *   2. The button handler (`handleModalRetry`) looks the stash up by
 *      `interaction.message.id` and re-shows the modal with
 *      `initialValues` fed back through the toolkit.
 *
 * The pre-show Redis lookup eats into the 3-second budget, which is
 * exactly the case `showModalWithTimeoutCatch` exists for (Discord
 * forbids deferring before `showModal`).
 */

import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  type ButtonInteraction,
  type ModalBuilder,
  type ModalSubmitInteraction,
} from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getSessionManager } from '../dashboard/index.js';
import { ackWithTimeoutCatch } from '../dashboard/ackWithTimeoutCatch.js';
import { showModalWithTimeoutCatch } from '../dashboard/showModalWithTimeoutCatch.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';

/** One string, three roles: logger name, customId action, session type. */
const MODAL_RETRY = 'modal-retry';

const logger = createLogger(MODAL_RETRY);

/** Action segment in the retry button's customId. */
const MODAL_RETRY_ACTION = MODAL_RETRY;

/** Session entity type for retry stashes (message-id keyed). */
const RETRY_ENTITY_TYPE = MODAL_RETRY;

/** Stash payload: which modal to rebuild, with what prefills. */
export interface ModalRetryStash {
  /** Consumer-defined modal kind (e.g. 'seed'). */
  kind: string;
  values: Record<string, string>;
  /**
   * Non-field context the rebuild needs (e.g. the personality UUID a modal
   * customId embeds). Kept separate from `values` so prefills stay purely
   * field-id-keyed.
   */
  meta?: Record<string, string>;
}

/** The "Try again" row attached to a validation-failure reply. */
export function buildModalRetryRow(commandPrefix: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${commandPrefix}::${MODAL_RETRY_ACTION}`)
      .setLabel('Try again')
      .setEmoji('🔁')
      .setStyle(ButtonStyle.Secondary)
  );
}

/** Guard for the retry button under a given command prefix. */
export function isModalRetryInteraction(customId: string, commandPrefix: string): boolean {
  return customId === `${commandPrefix}::${MODAL_RETRY_ACTION}`;
}

/**
 * Stash submitted values against the error reply's message id. Sessions
 * inherit the dashboard TTL (15 min) — past that, retry degrades to the
 * session-expired reply.
 */
export async function stashModalRetry(options: {
  userId: string;
  channelId: string;
  /** The error reply's message id — the retry button lives on it. */
  messageId: string;
  kind: string;
  values: Record<string, string>;
  meta?: Record<string, string>;
}): Promise<void> {
  await getSessionManager().set<ModalRetryStash>({
    userId: options.userId,
    entityType: RETRY_ENTITY_TYPE,
    entityId: options.messageId,
    data: { kind: options.kind, values: options.values, meta: options.meta },
    messageId: options.messageId,
    channelId: options.channelId,
  });
}

/**
 * Send a validation-failure reply carrying the Try-again button and stash
 * the submitted values against that reply — the one-call form consumers
 * use so the affordance can't be half-wired (button without stash or
 * vice versa).
 */
export async function replyWithModalRetry(
  interaction: Pick<ModalSubmitInteraction, 'editReply' | 'user' | 'channelId'>,
  options: {
    commandPrefix: string;
    kind: string;
    content: string;
    values: Record<string, string>;
    meta?: Record<string, string>;
  }
): Promise<void> {
  const reply = await interaction.editReply({
    content: options.content,
    components: [buildModalRetryRow(options.commandPrefix)],
  });
  await stashModalRetry({
    userId: interaction.user.id,
    // Metadata only — SessionManager never gates findByMessageId on it,
    // so the DM/thread null case degrades to '' harmlessly.
    channelId: interaction.channelId ?? '',
    messageId: reply.id,
    kind: options.kind,
    values: options.values,
    meta: options.meta,
  });
}

/**
 * Rebuild the modal for a stashed kind with the stashed prefills. Return
 * `null` for an unknown kind (stale stash across a deploy that renamed
 * kinds) — degrades to the session-expired reply.
 */
export type ModalRetryRebuilder = (
  kind: string,
  values: Record<string, string>,
  meta?: Record<string, string>
) => ModalBuilder | null;

/**
 * Handle a retry-button click: stash lookup by message id, then re-show
 * the modal prefilled. The lookup is pre-ack async work — the show is
 * routed through the timeout-catch wrapper per the 04-discord rule.
 */
export async function handleModalRetry(
  interaction: ButtonInteraction,
  rebuild: ModalRetryRebuilder,
  retryCommandHint: string
): Promise<void> {
  const stash = await getSessionManager().findByMessageId<ModalRetryStash>(interaction.message.id);

  const diag = {
    source: 'handleModalRetry',
    userId: interaction.user.id,
    entityId: interaction.message.id,
    sectionId: stash?.data.kind ?? 'expired',
  };
  const expiredReply = (): Promise<unknown> =>
    interaction.reply({
      content: renderSpec(CATALOG.progress.sessionExpired(retryCommandHint)),
      flags: MessageFlags.Ephemeral,
    });

  if (stash?.userId !== interaction.user.id) {
    // Expired (or, on a non-ephemeral surface, someone else's button).
    // The stash lookup already spent budget — timeout-catch the ack.
    await ackWithTimeoutCatch(interaction, expiredReply, diag, retryCommandHint);
    return;
  }

  const modal = rebuild(stash.data.kind, stash.data.values, stash.data.meta);
  if (modal === null) {
    logger.warn({ kind: stash.data.kind }, 'No rebuilder for stashed modal kind');
    await ackWithTimeoutCatch(interaction, expiredReply, diag, retryCommandHint);
    return;
  }

  await showModalWithTimeoutCatch(interaction, modal, diag, 'Please click Try again once more.');
}
