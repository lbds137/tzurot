/**
 * Deny Remove Subcommand Group
 *
 * Mirrors the add group's four scope subcommands and uses the same three-tier
 * permission model — you can only remove denials you have access to.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { checkDenyPermission } from './permissions.js';
import { describeDenyScope, resolveDenyTarget, scopeForSubcommand } from './denyTarget.js';

const logger = createLogger('deny-remove');

export async function handleRemove(context: DeferredCommandContext): Promise<void> {
  const scope = scopeForSubcommand(context.getSubcommand());
  if (scope === null) {
    await context.editReply(renderSpec(CATALOG.error.validation('Unknown denial scope.')));
    return;
  }

  const resolved = resolveDenyTarget(context);
  if (!resolved.ok) {
    await context.editReply(renderSpec(CATALOG.error.validation(resolved.message)));
    return;
  }

  const channelId = context.interaction.options.getChannel('channel')?.id ?? null;
  const character = context.getOption<string>('character');

  // Permission check + scopeId resolution
  const perm = await checkDenyPermission(context, scope, channelId, character);
  if (!perm.allowed) {
    return;
  }

  try {
    const { ownerClient } = clientsFor(context.interaction);
    const result = await ownerClient.removeDenylistEntry(
      resolved.target.type,
      resolved.target.discordId,
      scope,
      perm.scopeId
    );

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply(renderSpec(CATALOG.error.notFound('Denial entry')));
      } else {
        await context.editReply(
          renderSpec(
            classifyGatewayFailure(result, 'denial', { failedAction: 'remove the denial' })
          )
        );
      }
      return;
    }

    const scopeDesc = describeDenyScope(scope, { channelId, character });

    await context.editReply(`✅ Denial removed for ${resolved.target.display} ${scopeDesc}.`);
  } catch (error) {
    logger.error({ err: error }, 'Failed to remove denial');
    await context.editReply(
      renderSpec(classifyGatewayFailure(error, 'denial', { failedAction: 'remove the denial' }))
    );
  }
}
