/**
 * Foreign-application interaction guard.
 *
 * An interaction whose `applicationId` is not this bot's own was not addressed
 * to us: processing it would ack an interaction the owning application never
 * saw. The gateway does not deliver such interactions; a fork gateway can
 * (an open fork bug whose mechanism is not yet identified; see doc-109 G13b).
 * This guard is the defense against it. Drop them before anything else runs.
 */

import type { BaseInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { getCommandFromCustomId } from './customIds.js';
import { INTERACTION_FAMILIES } from './interactionFamilies.js';

const logger = createLogger('foreignInteraction');

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

  // The shared family table classifies the interaction for the drop log and
  // vouches for whether the family exposes a parseable customId command
  // prefix; the raw customId can embed user slugs and is never logged — the
  // parsed prefix is (pinned by the no-raw-customId test in
  // ./foreignInteraction.test.ts).
  const family = INTERACTION_FAMILIES.find(f => f.guard(interaction));

  let prefix: string | null = null;
  if (family?.carriesCustomId === true) {
    // TS cannot narrow through a table-driven guard; the matched row is what
    // establishes that this family's interaction has a customId.
    prefix = getCommandFromCustomId(
      (interaction as BaseInteraction & { customId: string }).customId
    );
  }

  logger.warn(
    {
      foreignApplicationId: interaction.applicationId,
      interactionType: family?.label ?? 'unknown',
      ...(prefix !== null ? { customIdPrefix: prefix } : {}),
    },
    'Ignoring interaction addressed to another application'
  );

  return true;
}
