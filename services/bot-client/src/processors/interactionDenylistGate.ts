/**
 * Interaction Denylist Gate
 *
 * Interaction-side counterpart to `DenylistFilter` (the message-side denial
 * check). Both route channel-scope through the same `DenylistCache.isChannelDenied`
 * thread→parent inheritance so a parent-channel denial blocks both messages
 * and slash commands/components in a child thread — previously only the
 * message path compensated for the cache's flat channel lookup.
 *
 * Takes plain values rather than a discord.js `Interaction` so it is
 * trivially unit-testable without constructing mock interaction objects.
 */

import { isBotOwner } from '@tzurot/common-types/utils/ownerMiddleware';
import type { DenylistCache } from '../services/DenylistCache.js';

export function isInteractionDenied(
  denylistCache: DenylistCache,
  args: {
    userId: string;
    guildId: string | null;
    channelId: string | null;
    /**
     * The thread's parent channel id, or null for a non-thread channel.
     * Callers derive this via `getThreadParentId(interaction.channel)`, and
     * `interaction.channel` can be null when Discord.js hasn't cached the
     * channel — in that case thread→parent inheritance silently degrades to
     * flat per-channel denial, same as before this fix.
     */
    parentChannelId: string | null;
  }
): boolean {
  // Safety: never deny the bot owner (self-lockout guard).
  if (isBotOwner(args.userId)) {
    return false;
  }

  const guildId = args.guildId ?? undefined;

  if (denylistCache.isBotDenied(args.userId, guildId)) {
    return true;
  }

  if (args.guildId !== null && denylistCache.isUserGuildDenied(args.userId, args.guildId)) {
    return true;
  }

  if (
    args.channelId !== null &&
    denylistCache.isChannelDenied(args.userId, args.channelId, args.parentChannelId)
  ) {
    return true;
  }

  return false;
}
