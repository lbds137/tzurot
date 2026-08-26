/**
 * "View Reasoning" — message context-menu shortcut to a message's reasoning
 * trace.
 *
 * Right-click any message → Apps → View Reasoning. Two lookup tiers, in order:
 *
 *  1. The diagnostic log (7d retention) — the same lookup "Inspect Message"
 *     uses, whose by-message → by-response fallback means clicking EITHER the
 *     triggering user message OR the AI's reply resolves to the same log.
 *  2. The reasoning trace persisted on the assistant's conversation-history
 *     row, which lives for the full history-retention window and dies with its
 *     row. This is what makes the command useful past 7d.
 *
 * Both tiers render through the same `buildReasoningTextView` and the shared
 * unpack path, so the output is identical regardless of which store answered.
 *
 * Access control: BOTH tiers filter server-side, and neither trusts this
 * client. The diagnostic lookup runs as the right-clicking user (their
 * UserClient) and the gateway returns only their own logs (bot owner: all).
 * The history tier calls `getMessageReasoning`, whose handler applies the
 * equivalent owner-or-own-rows predicate in its WHERE clause — a row belonging
 * to another user 404s exactly like a missing one. No filtering happens here,
 * so this entry point cannot widen what a non-owner can read.
 *
 * Distinct misses, kept distinguishable: neither tier resolving renders the
 * lookup's own message plus a pointer at the full /inspect surface, while a
 * resolved log or row carrying no trace renders the view builder's "no
 * reasoning" copy.
 *
 * The dispatcher has already deferred this interaction ephemeral (see
 * CommandHandler.handleContextMenuCommand) — replies go through editReply.
 */

import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { formatRelativeTimeDelta } from '@tzurot/common-types/utils/dateFormatting';
import { type UserClient } from '@tzurot/clients';
import { defineContextMenuCommand } from '../utils/defineCommand.js';
import { clientsFor } from '../utils/gatewayClients.js';
import { resolveDiagnosticLog } from './inspect/lookup.js';
import {
  buildReasoningView,
  buildReasoningTextView,
  type DebugViewResult,
} from './inspect/views.js';
import { computeViewContext } from './inspect/viewContext.js';
import { renderViewResult } from './inspect/index.js';
import { CATALOG } from '../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../ux/catalog/classify.js';
import { renderSpec } from '../ux/render/render.js';

const logger = createLogger('view-reasoning-context-menu');

/** Appended to a lookup miss: this shortcut is a subset of /inspect. */
const INSPECT_HINT = '\n• `/inspect` opens the full diagnostic view for a message';

/** Copy for a history row that exists but carries no trace. */
const NO_TRACE_FOR_MESSAGE = 'No reasoning content was captured for this message.';

/**
 * Tier 2: the trace persisted on the assistant's conversation-history row.
 *
 * Returns null when the gateway has no readable row for this message — either
 * it doesn't exist or it isn't the caller's, which the handler deliberately
 * collapses into the same 404. Callers fall through to the tier-1 miss copy.
 *
 * A non-404 failure is a real error and propagates to the command's catch;
 * degrading it to "not found" would report a broken gateway as an expired
 * trace.
 */
async function lookupPersistedReasoning(
  messageId: string,
  userClient: UserClient
): Promise<DebugViewResult | null> {
  const result = await userClient.getMessageReasoning(messageId);

  if (!result.ok) {
    if (result.status === 404) {
      return null;
    }
    throw new Error(`Reasoning history lookup failed: ${result.status} ${result.error}`);
  }

  const view = buildReasoningTextView(result.data.thinkingContent, NO_TRACE_FOR_MESSAGE);

  // Age is worth stating on THIS tier specifically. Tier 2 runs only after the
  // diagnostic lookup missed, and expiry at 7d is the usual reason (a log that
  // never existed, or belongs to another user, misses too) — so a trace arriving
  // here is typically old enough that "when was this?" is a real question. The
  // diagnostic tier carries no such line; anything it answers is within 7d.
  //
  // The line goes on `chunkedText.text`, NOT on `content`: `renderViewResult`
  // reads `chunkedText.text` and ignores `content` whenever the former is set,
  // which is every case that has a trace. An absent `chunkedText` therefore
  // also IS the no-trace case, so it needs no separate emptiness check —
  // dating an absence would be noise anyway.
  if (view.chunkedText === undefined) {
    return view;
  }
  const age = formatRelativeTimeDelta(result.data.createdAt);
  if (age === '') {
    return view;
  }
  return {
    ...view,
    chunkedText: {
      ...view.chunkedText,
      text: `-# Reasoning from a message ${age}\n${view.chunkedText.text}`,
    },
  };
}

export default defineContextMenuCommand({
  data: new ContextMenuCommandBuilder()
    .setName('View Reasoning')
    .setType(ApplicationCommandType.Message),

  execute: async interaction => {
    const { userClient } = clientsFor(interaction);

    try {
      // A raw snowflake classifies as a message-id lookup with the
      // by-message → by-response fallback — exactly right for a
      // right-clicked message.
      const result = await resolveDiagnosticLog(interaction.targetId, userClient);

      if (!result.success) {
        // The diagnostic aged out (7d) or never existed. Fall through to the
        // persisted trace, which outlives it — this is the whole point of the
        // second tier.
        const persisted = await lookupPersistedReasoning(interaction.targetId, userClient);
        if (persisted !== null) {
          await renderViewResult(interaction, persisted);
          logger.info(
            { targetId: interaction.targetId },
            'Reasoning trace retrieved from persisted history (diagnostic unavailable)'
          );
          return;
        }

        await interaction.editReply({
          content: renderSpec(CATALOG.error.validation(result.errorMessage + INSPECT_HINT)),
        });
        return;
      }

      const { log } = result;
      // Built against the right-clicking user because every view builder takes
      // the same third argument. buildReasoningView does not read it (its
      // parameter is `_ctx`), so access control here rests entirely on the
      // gateway's server-side per-user filtering in the lookup above.
      const viewContext = computeViewContext(log, interaction.user.id);
      const viewResult = buildReasoningView(log.data, log.requestId, viewContext);
      await renderViewResult(interaction, viewResult);

      logger.info(
        { requestId: log.requestId, personalityId: log.personalityId },
        'Reasoning trace retrieved via context menu'
      );
    } catch (error) {
      logger.error(
        { err: error, targetId: interaction.targetId },
        'Error fetching reasoning trace via context menu'
      );
      await interaction.editReply({
        content: renderSpec(
          classifyGatewayFailure(error, 'reasoning trace', { operation: 'read' })
        ),
      });
    }
  },
});
