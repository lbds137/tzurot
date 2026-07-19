/**
 * "Inspect Message" — message context-menu entry point for /inspect.
 *
 * Right-click any message → Apps → Inspect Message. The target message's id
 * feeds the same diagnostic lookup the slash command uses, whose
 * by-message → by-response fallback means clicking EITHER the triggering
 * user message OR the AI's reply resolves to the same diagnostic log. The
 * summary render (embed + view buttons/select) is shared with `/inspect`,
 * so every follow-on view works identically from here.
 *
 * Access control: identical to /inspect — the lookup runs as the user who
 * RIGHT-CLICKED (their UserClient), and the gateway filters server-side
 * (bot owner sees all logs; everyone else only their own), so this entry
 * point cannot surface someone else's diagnostic log.
 *
 * The dispatcher has already deferred this interaction ephemeral (see
 * CommandHandler.handleContextMenuCommand) — replies go through editReply.
 */

import { ApplicationCommandType, ContextMenuCommandBuilder } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { defineContextMenuCommand } from '../utils/defineCommand.js';
import { clientsFor } from '../utils/gatewayClients.js';
import { resolveDiagnosticLog } from './inspect/lookup.js';
import { buildDiagnosticEmbed } from './inspect/embed.js';
import { buildInspectComponents } from './inspect/components.js';
import { CATALOG } from '../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../ux/catalog/classify.js';
import { renderSpec } from '../ux/render/render.js';

const logger = createLogger('inspect-message-context-menu');

export default defineContextMenuCommand({
  data: new ContextMenuCommandBuilder()
    .setName('Inspect Message')
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
          content: renderSpec(CATALOG.error.validation(result.errorMessage)),
        });
        return;
      }

      const { log } = result;
      const embed = buildDiagnosticEmbed(log.data);
      const components = buildInspectComponents(
        log.requestId,
        log.data.postProcessing.thinkingContent?.length ?? 0
      );

      await interaction.editReply({ embeds: [embed], components });

      logger.info(
        { requestId: log.requestId, personalityId: log.personalityId },
        'Diagnostic log retrieved via context menu'
      );
    } catch (error) {
      logger.error(
        { err: error, targetId: interaction.targetId },
        'Error fetching diagnostic log via context menu'
      );
      await interaction.editReply({
        content: renderSpec(classifyGatewayFailure(error, 'diagnostic log', { operation: 'read' })),
      });
    }
  },
});
