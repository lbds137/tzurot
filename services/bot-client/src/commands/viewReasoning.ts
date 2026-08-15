/**
 * "View Reasoning" — message context-menu shortcut to a message's reasoning
 * trace.
 *
 * Right-click any message → Apps → View Reasoning. Same diagnostic lookup
 * "Inspect Message" uses, whose by-message → by-response fallback means
 * clicking EITHER the triggering user message OR the AI's reply resolves to
 * the same diagnostic log; the trace is then rendered through /inspect's own
 * Reasoning view builder and its shared unpack path, so the output is
 * identical to the button route — this command is pure routing.
 *
 * Access control: identical to /inspect — the lookup runs as the user who
 * RIGHT-CLICKED (their UserClient) and the gateway filters server-side (bot
 * owner sees all logs; everyone else only their own), so this entry point
 * cannot surface someone else's reasoning trace.
 *
 * Two distinct misses, kept distinguishable: no diagnostic resolved (outside
 * the retention window, or not this user's) renders the lookup's own message
 * plus a pointer at the full /inspect surface, while a resolved log carrying
 * no trace renders the view builder's "no reasoning content captured" copy.
 *
 * The dispatcher has already deferred this interaction ephemeral (see
 * CommandHandler.handleContextMenuCommand) — replies go through editReply.
 */

import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { defineContextMenuCommand } from '../utils/defineCommand.js';
import { clientsFor } from '../utils/gatewayClients.js';
import { resolveDiagnosticLog } from './inspect/lookup.js';
import { buildReasoningView } from './inspect/views.js';
import { computeViewContext } from './inspect/viewContext.js';
import { renderViewResult } from './inspect/index.js';
import { CATALOG } from '../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../ux/catalog/classify.js';
import { renderSpec } from '../ux/render/render.js';

const logger = createLogger('view-reasoning-context-menu');

/** Appended to a lookup miss: this shortcut is a subset of /inspect. */
const INSPECT_HINT = '\n• `/inspect` opens the full diagnostic view for a message';

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
