/**
 * Deny Command Permission Checking
 *
 * Three-tier permission model:
 * 1. Bot owner: all scopes
 * 2. Server mods (Manage Messages): GUILD and CHANNEL scope within their guild
 * 3. Character creators: PERSONALITY scope for characters they own
 */

import { isBotOwner, GATEWAY_TIMEOUTS } from '@tzurot/common-types';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { requireManageMessagesContext } from '../../utils/permissions.js';
import { callGatewayApi } from '../../utils/userGatewayClient.js';

interface PermissionResult {
  allowed: boolean;
  scopeId: string;
}

const DENIED: PermissionResult = { allowed: false, scopeId: '' };

/**
 * Check if the user has permission for the given scope and resolve the scopeId.
 *
 * @returns `{ allowed: true, scopeId }` if permitted, `{ allowed: false }` if not (error already sent).
 */
export async function checkDenyPermission(
  context: DeferredCommandContext,
  scope: string,
  channelId: string | null,
  personalitySlug: string | null
): Promise<PermissionResult> {
  const isOwner = isBotOwner(context.user.id);

  // BOT scope: owner only
  if (scope === 'BOT') {
    if (!isOwner) {
      await context.editReply('❌ Only the bot owner can manage bot-wide denials.');
      return DENIED;
    }
    return { allowed: true, scopeId: '*' };
  }

  // GUILD and CHANNEL scopes: owner or server mod
  if (scope === 'GUILD' || scope === 'CHANNEL') {
    if (!isOwner && !(await requireManageMessagesContext(context))) {
      return DENIED;
    }
    return resolveModScopeId(context, scope, channelId);
  }

  // PERSONALITY scope: owner or character creator
  if (scope === 'PERSONALITY') {
    return checkPersonalityPermission(context, isOwner, personalitySlug);
  }

  await context.editReply('❌ Invalid scope.');
  return DENIED;
}

async function resolveModScopeId(
  context: DeferredCommandContext,
  scope: string,
  channelId: string | null
): Promise<PermissionResult> {
  if (scope === 'GUILD') {
    if (context.guildId === null) {
      await context.editReply('❌ Guild scope requires being in a server.');
      return DENIED;
    }
    return { allowed: true, scopeId: context.guildId };
  }

  // CHANNEL scope
  if (channelId === null) {
    await context.editReply('❌ Channel scope requires the `channel` option.');
    return DENIED;
  }
  return { allowed: true, scopeId: channelId };
}

async function checkPersonalityPermission(
  context: DeferredCommandContext,
  isOwner: boolean,
  personalitySlug: string | null
): Promise<PermissionResult> {
  if (personalitySlug === null || personalitySlug.length === 0) {
    await context.editReply('❌ Personality scope requires the `personality` option.');
    return DENIED;
  }

  const result = await callGatewayApi<{ personality: { id: string }; canEdit: boolean }>(
    `/user/personality/${encodeURIComponent(personalitySlug)}`,
    { userId: context.user.id, timeout: GATEWAY_TIMEOUTS.DEFERRED }
  );

  if (!result.ok) {
    await context.editReply(`❌ Character "${personalitySlug}" not found.`);
    return DENIED;
  }

  if (!isOwner && !result.data.canEdit) {
    await context.editReply('❌ You can only manage denials for characters you own.');
    return DENIED;
  }

  return { allowed: true, scopeId: result.data.personality.id };
}
