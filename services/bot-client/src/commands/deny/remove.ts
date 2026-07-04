/**
 * Deny Remove Subcommand
 *
 * Removes a denylist entry. Uses the same three-tier permission
 * model as add — you can only remove denials you have access to.
 */

import { createLogger } from '@tzurot/common-types/utils/logger';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { clientsFor } from '../../utils/gatewayClients.js';
import { checkDenyPermission } from './permissions.js';
import { stripMention } from './mentionUtils.js';

const logger = createLogger('deny-remove');

export async function handleRemove(context: DeferredCommandContext): Promise<void> {
  const type = context.getOption<string>('type') ?? 'USER';
  const target = stripMention(context.getRequiredOption<string>('target'));
  const scope = context.getOption<string>('scope') ?? 'BOT';
  const channelId = context.interaction.options.getChannel('channel')?.id ?? null;
  const personality = context.getOption<string>('character');

  // Permission check + scopeId resolution
  const perm = await checkDenyPermission(context, scope, channelId, personality);
  if (!perm.allowed) {
    return;
  }

  try {
    const { ownerClient } = clientsFor(context.interaction);
    const result = await ownerClient.removeDenylistEntry(type, target, scope, perm.scopeId);

    if (!result.ok) {
      if (result.status === 404) {
        await context.editReply('❌ No matching denial entry found.');
      } else {
        await context.editReply(`❌ Failed: ${result.error}`);
      }
      return;
    }

    const targetDisplay = type === 'USER' ? `<@${target}> (\`${target}\`)` : `\`${target}\``;
    await context.editReply(
      `✅ Denial removed for ${targetDisplay} (${scope.toLowerCase()} scope).`
    );
  } catch (error) {
    logger.error({ err: error }, 'Failed to remove denial');
    await context.editReply('❌ Failed to remove denial. Please try again.');
  }
}
