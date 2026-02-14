/**
 * Deny Remove Subcommand
 *
 * Removes a denylist entry. Uses the same three-tier permission
 * model as add — you can only remove denials you have access to.
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { adminFetch } from '../../utils/adminApiClient.js';
import { checkDenyPermission } from './permissions.js';

const logger = createLogger('deny-remove');

/** Strip Discord mention wrappers: <@123>, <@!123> → 123 */
function stripMention(input: string): string {
  const match = /^<@!?(\d+)>$/.exec(input);
  return match !== null ? match[1] : input;
}

export async function handleRemove(context: DeferredCommandContext): Promise<void> {
  const type = context.getOption<string>('type') ?? 'USER';
  const target = stripMention(context.getRequiredOption<string>('target'));
  const scope = context.getOption<string>('scope') ?? 'BOT';
  const channelId = context.interaction.options.getChannel('channel')?.id ?? null;
  const personality = context.getOption<string>('personality');

  // Permission check + scopeId resolution
  const perm = await checkDenyPermission(context, scope, channelId, personality);
  if (!perm.allowed) {
    return;
  }

  try {
    const segments = [type, target, scope, perm.scopeId].map(encodeURIComponent);
    const path = `/admin/denylist/${segments.join('/')}`;
    const response = await adminFetch(path, { method: 'DELETE', userId: context.user.id });

    if (!response.ok) {
      if (response.status === 404) {
        await context.editReply('❌ No matching denial entry found.');
      } else {
        const body = (await response.json()) as { message?: string };
        await context.editReply(`❌ Failed: ${body.message ?? 'Unknown error'}`);
      }
      return;
    }

    const targetDisplay = type === 'USER' ? `<@${target}> (\`${target}\`)` : `\`${target}\``;
    await context.editReply(
      `✅ Denial removed for ${targetDisplay} (${scope.toLowerCase()} scope).`
    );
  } catch (error) {
    logger.error({ err: error }, '[Deny] Failed to remove denial');
    await context.editReply('❌ Failed to remove denial. Please try again.');
  }
}
