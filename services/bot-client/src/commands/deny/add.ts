/**
 * Deny Add Subcommand
 *
 * Adds a denylist entry. Validates scope/type combinations and
 * checks three-tier permissions before calling the gateway API.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { classifyGatewayFailure } from '../../ux/catalog/classify.js';
import { renderSpec } from '../../ux/render/render.js';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { checkDenyPermission } from './permissions.js';
import { stripMention } from './mentionUtils.js';

const logger = createLogger('deny-add');

export async function handleAdd(context: DeferredCommandContext): Promise<void> {
  const type = context.getOption<string>('type') ?? 'USER';
  const target = stripMention(context.getRequiredOption<string>('target'));
  const scope = context.getOption<string>('scope') ?? 'BOT';
  const channelId = context.interaction.options.getChannel('channel')?.id ?? null;
  const personality = context.getOption<string>('character');
  const reason = context.getOption<string>('reason');
  const mode = context.getOption<string>('mode') ?? 'BLOCK';

  // GUILD type can only use BOT scope
  if (type === 'GUILD' && scope !== 'BOT') {
    await context.editReply(
      renderSpec(CATALOG.error.validation('Server denials only support Bot scope.'))
    );
    return;
  }

  // Permission check + scopeId resolution
  const perm = await checkDenyPermission(context, scope, channelId, personality);
  if (!perm.allowed) {
    return;
  }

  try {
    const { ownerClient } = clientsFor(context.interaction);
    const result = await ownerClient.addDenylistEntry({
      type: type as 'USER' | 'GUILD',
      discordId: target,
      scope: scope as 'BOT' | 'GUILD' | 'CHANNEL' | 'PERSONALITY',
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

    const targetDisplay = type === 'USER' ? `<@${target}> (\`${target}\`)` : `\`${target}\``;
    const label = type === 'GUILD' ? 'Server' : 'User';
    const scopeDesc =
      scope === 'BOT'
        ? 'bot-wide'
        : scope === 'GUILD'
          ? 'guild-scoped'
          : `${scope.toLowerCase()}-scoped`;
    const modeDesc = mode === 'MUTE' ? ', muted' : '';

    await context.editReply(`✅ ${label} ${targetDisplay} denied (${scopeDesc}${modeDesc}).`);
  } catch (error) {
    logger.error({ err: error }, 'Failed to add denial');
    await context.editReply(
      renderSpec(classifyGatewayFailure(error, 'denial', { failedAction: 'add the denial' }))
    );
  }
}
