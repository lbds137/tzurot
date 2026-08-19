/**
 * Reports `guildMemberUpdate` events to the gateway so a user's stored
 * last-known guild membership refreshes the moment it changes.
 *
 * Everything else that refreshes that stored value is opportunistic — it
 * happens because a turn's Discord fetch happened to observe the member. This
 * is the one event-driven source, so it is what keeps a role rename from
 * sitting stale in `<participants>` until the next time that person speaks.
 *
 * The report goes through the gateway rather than straight to the database
 * because bot-client is Prisma-free (`01-architecture.md`). It is
 * fire-and-forget: a failed report costs freshness on one field, never the
 * event loop, so nothing here rejects.
 */

import { Events, type Client, type GuildMember, type PartialGuildMember } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { extractGuildInfoFromMember } from './channelFetcher/ParticipantContextCollector.js';
import { getServiceClient } from '../utils/gatewayClients.js';

const logger = createLogger('GuildMemberInfoReporter');

/**
 * True when nothing the prompt renders actually changed.
 *
 * `guildMemberUpdate` fires for edits this store does not care about — a
 * timeout expiring, a pending-membership flag, an avatar — and each one would
 * otherwise be a gateway round-trip and a database write that cannot change a
 * single rendered byte. Comparing the extracted shape rather than the raw
 * member is what makes that decidable, since the extraction is exactly the
 * part that reaches the prompt.
 */
function rendersIdentically(before: GuildMember | PartialGuildMember, after: GuildMember): boolean {
  // A partial `before` has no reliable role cache to compare against, so treat
  // it as changed rather than risk skipping a real update. Discord sends
  // partials only when the member was never cached, which makes this the first
  // observation of them anyway — exactly the case worth writing.
  if (before.partial) {
    return false;
  }
  const a = extractGuildInfoFromMember(before);
  const b = extractGuildInfoFromMember(after);
  return (
    a.displayColor === b.displayColor &&
    a.joinedAt === b.joinedAt &&
    a.roles.length === b.roles.length &&
    a.roles.every((role, i) => role === b.roles[i])
  );
}

/**
 * Subscribe to `guildMemberUpdate`. Requires the `GuildMembers` intent, which
 * the client already declares — without it this listener is simply never
 * called, and the stored value falls back to opportunistic refresh.
 */
export function registerGuildMemberInfoReporter(client: Client): void {
  client.on(Events.GuildMemberUpdate, (before, after) => {
    if (after.user.bot || rendersIdentically(before, after)) {
      return;
    }

    void getServiceClient()
      .recordGuildMemberInfo({
        guildId: after.guild.id,
        discordUserId: after.id,
        info: extractGuildInfoFromMember(after),
      })
      .catch((err: unknown) => {
        logger.warn({ err, guildId: after.guild.id }, 'Failed to report guild member update');
      });
  });
}
