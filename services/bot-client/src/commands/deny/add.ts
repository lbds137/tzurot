/**
 * Deny Add Subcommand
 *
 * Adds a denylist entry. Validates scope/type combinations and
 * checks three-tier permissions before calling the gateway API.
 */

import { createLogger } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { adminPostJson } from '../../utils/adminApiClient.js';
import { checkDenyPermission } from './permissions.js';

const logger = createLogger('deny-add');

/** Strip Discord mention wrappers: <@123>, <@!123> → 123 */
function stripMention(input: string): string {
  const match = /^<@!?(\d+)>$/.exec(input);
  return match !== null ? match[1] : input;
}

export async function handleAdd(context: DeferredCommandContext): Promise<void> {
  const type = context.getOption<string>('type') ?? 'USER';
  const target = stripMention(context.getRequiredOption<string>('target'));
  const scope = context.getOption<string>('scope') ?? 'BOT';
  const channelId = context.interaction.options.getChannel('channel')?.id ?? null;
  const personality = context.getOption<string>('personality');
  const reason = context.getOption<string>('reason');
  const mode = context.getOption<string>('mode') ?? 'BLOCK';

  // GUILD type can only use BOT scope
  if (type === 'GUILD' && scope !== 'BOT') {
    await context.editReply('❌ Server denials only support Bot scope.');
    return;
  }

  // Permission check + scopeId resolution
  const perm = await checkDenyPermission(context, scope, channelId, personality);
  if (!perm.allowed) {
    return;
  }

  try {
    const response = await adminPostJson(
      '/admin/denylist',
      {
        type,
        discordId: target,
        scope,
        scopeId: perm.scopeId,
        mode,
        reason: reason ?? undefined,
      },
      context.user.id
    );

    if (!response.ok) {
      const body = (await response.json()) as { message?: string };
      await context.editReply(`❌ Failed: ${body.message ?? 'Unknown error'}`);
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
    logger.error({ err: error }, '[Deny] Failed to add denial');
    await context.editReply('❌ Failed to add denial. Please try again.');
  }
}
