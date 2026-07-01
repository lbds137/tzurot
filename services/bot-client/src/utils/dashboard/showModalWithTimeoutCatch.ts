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
 * Thin wrapper over `ackWithTimeoutCatch` — see its JSDoc for the full
 * 10062 / followUp semantics.
 */

import {
  type ModalBuilder,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type StringSelectMenuInteraction,
} from 'discord.js';
import { ackWithTimeoutCatch, type InteractionAckDiagContext } from './ackWithTimeoutCatch.js';

export async function showModalWithTimeoutCatch(
  interaction: StringSelectMenuInteraction | ButtonInteraction | ChatInputCommandInteraction,
  modal: ModalBuilder,
  diagContext: InteractionAckDiagContext,
  retryMessage: string
): Promise<void> {
  await ackWithTimeoutCatch(
    interaction,
    () => interaction.showModal(modal),
    diagContext,
    retryMessage
  );
}
