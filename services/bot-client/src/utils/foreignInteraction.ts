/**
 * Foreign-application interaction guard.
 *
 * An interaction whose `applicationId` is not this bot's own was not addressed
 * to us: processing it would ack an interaction the owning application never
 * saw. The gateway does not deliver such interactions; a fork gateway can
 * (its cross-application delivery bug has been fixed server-side, and this is
 * the defense-in-depth half). Drop them before anything else runs.
 */

import type { BaseInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getCommandFromCustomId } from './customIds.js';

const logger = createLogger('foreignInteraction');

/**
 * Classify the interaction family for the drop log, using discord.js's own
 * type guards in a fixed order (the order only matters for a mock that reports
 * more than one guard true; a real interaction matches exactly one).
 */
function interactionTypeOf(interaction: BaseInteraction): string {
  if (interaction.isChatInputCommand()) {
    return 'chat_input';
  }
  if (interaction.isMessageContextMenuCommand()) {
    return 'message_context_menu';
  }
  if (interaction.isModalSubmit()) {
    return 'modal_submit';
  }
  if (interaction.isAutocomplete()) {
    return 'autocomplete';
  }
  if (interaction.isStringSelectMenu()) {
    return 'string_select_menu';
  }
  if (interaction.isButton()) {
    return 'button';
  }
  return 'unknown';
}

/**
 * True when the interaction was addressed to a different application.
 *
 * Must run before ANY processing or acknowledgement — including before the
 * maintenance gate, whose reply is an ack (pinned by the zero-ack tests in
 * `../handlers/interactionRouter.test.ts`).
 *
 * Fails open when `client.application` is not populated: a delivered
 * interaction implies the client is past READY, where the application is set,
 * so the undefined branch is expected to be unreachable in practice — it is
 * a guard against a surprise, not a sanctioned path (pinned by the fail-open
 * test in `./foreignInteraction.test.ts`).
 */
export function isForeignInteraction(interaction: BaseInteraction): boolean {
  const ownId = interaction.client.application?.id;
  if (ownId === undefined) {
    return false;
  }
  if (interaction.applicationId === ownId) {
    return false;
  }

  // Only the customId-bearing families carry a parseable command prefix; the
  // raw customId can embed user slugs and is never logged — the parsed prefix
  // is (pinned by the no-raw-customId test in ./foreignInteraction.test.ts).
  let prefix: string | null = null;
  if (interaction.isModalSubmit() || interaction.isStringSelectMenu() || interaction.isButton()) {
    prefix = getCommandFromCustomId(interaction.customId);
  }

  logger.warn(
    {
      foreignApplicationId: interaction.applicationId,
      interactionType: interactionTypeOf(interaction),
      ...(prefix !== null ? { customIdPrefix: prefix } : {}),
    },
    'Ignoring interaction addressed to another application'
  );

  return true;
}
