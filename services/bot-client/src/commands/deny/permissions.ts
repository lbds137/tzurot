/**
 * Deny Command Permission Checking
 *
 * Three-tier permission model:
 * 1. Bot owner: all scopes
 * 2. Server mods (Manage Messages): GUILD and CHANNEL scope within their guild
 * 3. Character creators: PERSONALITY scope for characters they own
 */

import { escapeMarkdown } from 'discord.js';
import { CATALOG } from '../../ux/catalog/catalog.js';
import { renderSpec } from '../../ux/render/render.js';
import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import { isInfraFailure } from '@tzurot/clients';
import type { DeferredCommandContext } from '../../utils/commandContext/types.js';
import { requireManageMessagesContext } from '../../utils/permissions.js';
import {
  AUTOCOMPLETE_UNAVAILABLE_MESSAGE,
  isAutocompleteErrorSentinel,
} from '../../utils/apiCheck.js';
import { clientsFor } from '../../utils/gatewayClients.js';

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
      await context.editReply(
        renderSpec(
          CATALOG.error.permissionDenied('manage bot-wide denials — only the bot owner can')
        )
      );
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

  await context.editReply(renderSpec(CATALOG.error.validation('Invalid scope.')));
  return DENIED;
}

async function resolveModScopeId(
  context: DeferredCommandContext,
  scope: string,
  channelId: string | null
): Promise<PermissionResult> {
  if (scope === 'GUILD') {
    if (context.guildId === null) {
      await context.editReply(
        renderSpec(CATALOG.error.validation('Guild scope requires being in a server.'))
      );
      return DENIED;
    }
    return { allowed: true, scopeId: context.guildId };
  }

  // CHANNEL scope
  if (channelId === null) {
    await context.editReply(
      renderSpec(CATALOG.error.validation('Channel scope requires the `channel` option.'))
    );
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
    await context.editReply(
      renderSpec(CATALOG.error.validation('Personality scope requires the `personality` option.'))
    );
    return DENIED;
  }

  if (isAutocompleteErrorSentinel(personalitySlug)) {
    await context.editReply({ content: AUTOCOMPLETE_UNAVAILABLE_MESSAGE });
    return DENIED;
  }

  const { userClient } = clientsFor(context.interaction);
  const result = await userClient.getPersonality(personalitySlug);

  if (!result.ok) {
    // Distinguish "can't reach the gateway" (transient, retryable) from a genuine
    // not-found / access-denied. A blip must not read as "the character doesn't
    // exist" — fail safe (still DENIED) but tell the user to retry.
    await context.editReply(
      isInfraFailure(result)
        ? renderSpec(CATALOG.error.transient("Couldn't reach the server right now."))
        : renderSpec(CATALOG.error.notFound('Character', { name: escapeMarkdown(personalitySlug) }))
    );
    return DENIED;
  }

  if (!isOwner && !result.data.canEdit) {
    await context.editReply(
      renderSpec(
        CATALOG.error.permissionDenied(
          'manage denials for this character — you can only manage characters you own'
        )
      )
    );
    return DENIED;
  }

  return { allowed: true, scopeId: result.data.personality.id };
}
