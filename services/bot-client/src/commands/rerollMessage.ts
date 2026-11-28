/**
 * "Reroll" — message context-menu command to regenerate a character's latest reply.
 *
 * Right-click a character's latest reply → Apps → Reroll. The reply is
 * regenerated for the same turn and replaces the old one in place: the same
 * Discord messages are edited, the old history row is replaced and the old
 * reply's memories are removed.
 *
 * Access control is server-side (the gateway's preflight 404s a non-owner like
 * a missing message). Only the character's latest reply can be rerolled and a
 * locked memory refuses before any model call.
 *
 * The dispatcher has already deferred this interaction ephemerally; the
 * deferred placeholder stays until the result handler (or a refusal here)
 * fills it, so the user sees exactly one reply.
 */

import { randomUUID } from 'node:crypto';
import {
  ApplicationCommandType,
  ContextMenuCommandBuilder,
  type MessageContextMenuCommandInteraction,
} from 'discord.js';
import type { UserClient } from '@tzurot/clients';
import { API_ERROR_SUBCODE } from '@tzurot/common-types/constants/error';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { redis } from '../redis.js';
import { acquireRerollGuard, releaseRerollGuard } from '../services/character/rerollGuard.js';
import { submitRerollTurn } from '../services/character/rerollTurn.js';
import { getPersonalityLoader } from '../services/serviceRegistry.js';
import { defineContextMenuCommand } from '../utils/defineCommand.js';
import { rerollPreflightMessage } from '../utils/editResponse/rerollPreflight.js';
import { clientsFor } from '../utils/gatewayClients.js';
import { resolveMessageCharacterOrReply } from '../utils/messageCharacterLookup.js';
import { CATALOG } from '../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../ux/catalog/classify.js';
import { replySpec, replySpecSafe } from '../ux/render/reply.js';

const logger = createLogger('reroll-message');

const NOT_YOURS_MESSAGE = "This isn't one of your character replies.";
const NOT_LATEST_MESSAGE = 'Only the latest reply from a character can be rerolled.';
const ALREADY_REROLLING_MESSAGE = 'This reply is already being rerolled.';

type CheckFailure = Extract<
  Awaited<ReturnType<UserClient['checkRerollAssistantMessage']>>,
  { ok: false }
>;

async function replyCheckFailure(
  interaction: MessageContextMenuCommandInteraction,
  check: CheckFailure
): Promise<void> {
  if (check.status === 404) {
    await replySpec(interaction, CATALOG.error.validation(NOT_YOURS_MESSAGE));
  } else if (check.status === 409 && check.code === API_ERROR_SUBCODE.NOT_LATEST) {
    await replySpec(interaction, CATALOG.error.validation(NOT_LATEST_MESSAGE));
  } else {
    await replySpec(interaction, classifyGatewayFailure(check, 'response', { operation: 'read' }));
  }
}

export default defineContextMenuCommand({
  data: new ContextMenuCommandBuilder().setName('Reroll').setType(ApplicationCommandType.Message),

  execute: async interaction => {
    const resolved = await resolveMessageCharacterOrReply(interaction, { needIncognito: true });
    if (resolved === null) {
      return;
    }

    const targetId = interaction.targetMessage.id;
    const { userClient } = clientsFor(interaction);
    const attemptId = randomUUID();
    let heldRowId: string | null = null;

    try {
      const first = await userClient.checkRerollAssistantMessage(targetId, {});
      if (!first.ok) {
        await replyCheckFailure(interaction, first);
        return;
      }

      if (!(await acquireRerollGuard(redis, first.data.rowId, attemptId))) {
        await replySpec(interaction, CATALOG.error.validation(ALREADY_REROLLING_MESSAGE));
        return;
      }
      heldRowId = first.data.rowId;

      // Another reroll may have finished between the first check and the guard;
      // the preflight used for generation is the one read under the guard.
      const check = await userClient.checkRerollAssistantMessage(targetId, {});
      if (!check.ok) {
        await replyCheckFailure(interaction, check);
        return;
      }
      const preflight = check.data;
      if (preflight.rowId !== first.data.rowId) {
        await replySpec(interaction, CATALOG.error.validation(NOT_LATEST_MESSAGE));
        return;
      }

      const refusal = rerollPreflightMessage(preflight.memoryPlan);
      if (refusal !== null) {
        await replySpec(interaction, CATALOG.error.validation(refusal));
        return;
      }

      const personality = await getPersonalityLoader().loadPersonalityStrict(
        resolved.personalitySlug,
        interaction.user.id
      );
      if (personality === null) {
        await replySpec(interaction, CATALOG.error.validation(NOT_YOURS_MESSAGE));
        return;
      }

      const outcome = await submitRerollTurn({
        interaction,
        preflight,
        personality,
        attemptId,
        // A legacy row without a stored flag is inferred at lookup time.
        incognito: preflight.incognito || resolved.incognito,
      });
      if (outcome.kind === 'refused') {
        if (outcome.message !== null) {
          await replySpec(interaction, CATALOG.error.validation(outcome.message));
        }
        return;
      }
      // Submitted: the result handler owns the guard from here.
      heldRowId = null;
    } catch (error) {
      logger.error({ err: error, targetId }, 'Failed to start the reroll');
      await replySpecSafe(
        interaction,
        classifyGatewayFailure(error, 'response', { operation: 'write' })
      );
    } finally {
      if (heldRowId !== null) {
        await releaseRerollGuard(redis, heldRowId, attemptId);
      }
    }
  },
});
