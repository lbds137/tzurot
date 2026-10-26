/**
 * Shared page-load failure follow-up for browse pagination and select handlers.
 *
 * Every browse surface acks with an update before fetching the next page, so
 * a fetch failure has nothing to edit into — the current view stays as-is by
 * construction and the user gets an ephemeral follow-up instead of silence.
 * The failure itself may arrive as either a caught error or a failed gateway
 * result (`{ ok: false, ... }`) handled inline inside the try block.
 */

import { MessageFlags, type MessageComponentInteraction } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';

const logger = createLogger('browse-page-load-failure');

/**
 * Tell the user their page fetch failed, without disturbing the page they
 * are looking at. Call it from a browse pagination or select handler's catch,
 * or from a `!result.ok` guard inside the try, after the site's own log line.
 * The resource names what failed to load (default `'page'`; a select handler
 * passes the picked item's noun).
 *
 * The notification itself is best-effort: a rejected `followUp` is logged
 * and swallowed rather than propagated, so a call from inside a `try` whose
 * `catch` also calls this helper cannot re-enter that `catch` (pinned by
 * pageLoadFailure.test.ts "a rejected follow-up is logged, not propagated").
 */
export async function followUpBrowsePageFailure(
  interaction: MessageComponentInteraction,
  error: unknown,
  resource = 'page'
): Promise<void> {
  try {
    await interaction.followUp({
      content: renderSpec(classifyGatewayFailure(error, resource, { operation: 'read' })),
      flags: MessageFlags.Ephemeral,
    });
  } catch (err) {
    logger.warn(
      { err, customId: interaction.customId },
      'Could not notify the user of the page-load failure'
    );
  }
}
