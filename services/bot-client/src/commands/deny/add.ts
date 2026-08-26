/**
 * Deny Add Subcommand Group
 *
 * Handles all four scope subcommands (`everywhere`, `this-server`, `channel`,
 * `character`). The scope comes from the subcommand name and the entity type
 * from the filled target option, then the three-tier permission check runs
 * before the gateway call.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { checkDenyPermission } from './permissions.js';
import { describeDenyScope, resolveDenyTarget, scopeForSubcommand } from './denyTarget.js';

const logger = createLogger('deny-add');

export async function handleAdd(context: DeferredCommandContext): Promise<void> {
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
  const reason = context.getOption<string>('reason');
  const mode = context.getOption<string>('mode') ?? 'BLOCK';

  // Permission check + scopeId resolution
  const perm = await checkDenyPermission(context, scope, channelId, character);
  if (!perm.allowed) {
    return;
  }

  try {
    const { ownerClient } = clientsFor(context.interaction);
    const result = await ownerClient.addDenylistEntry({
      type: resolved.target.type,
      discordId: resolved.target.discordId,
      scope,
      scopeId: perm.scopeId,
      mode: mode as 'BLOCK' | 'MUTE',
      reason: reason ?? undefined,
    });

    if (!result.ok) {
      await context.editReply(
        renderSpec(classifyGatewayFailure(result, 'denial', { failedAction: 'add the denial' }))
      );
      return;
    }

    const modeDesc = mode === 'MUTE' ? 'muted (ignored, but still kept in context)' : 'blocked';
    const scopeDesc = describeDenyScope(scope, { channelId, character });

    await context.editReply(`✅ Denied ${resolved.target.display} ${scopeDesc} — ${modeDesc}.`);
  } catch (error) {
    logger.error({ err: error }, 'Failed to add denial');
    await context.editReply(
      renderSpec(classifyGatewayFailure(error, 'denial', { failedAction: 'add the denial' }))
    );
  }
}
