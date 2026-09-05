/**
 * Reports `guildMemberUpdate` and `guildMemberRemove` events to the gateway
 * so a user's stored last-known guild membership stays current.
 *
 * The update listener is one event-driven refresh source — role/nickname/
 * colour changes are otherwise only picked up opportunistically, when a
 * turn's Discord fetch happens to observe the member — so it keeps a role
 * rename from sitting stale in `<participants>` until that person next
 * speaks. The remove listener is what stops a departed member from
 * rendering at all: without it, the stored row for someone who has left a
 * guild would linger forever, since nothing else observes a departure.
 *
 * Both reports go through the gateway rather than straight to the database
 * because bot-client is Prisma-free (`01-architecture.md`). Both are
 * fire-and-forget: a failed report costs freshness on one field (or leaves
 * a departed member rendering one turn longer), never the event loop, so
 * nothing here rejects — but a failure is still logged, whether it arrives
 * as a resolved `{ ok: false }` envelope or a thrown rejection.
 */

import { Events, type Client, type GuildMember, type PartialGuildMember } from 'discord.js';
import { createLogger } from '@tzurot/common-types/utils/logger';
import { type GatewayResult } from '@tzurot/clients';
import { extractGuildInfoFromMember } from './channelFetcher/ParticipantContextCollector.js';
import { getServiceClient } from '../utils/gatewayClients.js';

const logger = createLogger('GuildMemberInfoReporter');

/**
 * Log a gateway report that resolved with `{ ok: false }`.
 *
 * `callGateway` (`@tzurot/clients` transport) resolves `{ ok: false }` for
 * HTTP errors, schema drift, and network/timeout failures alike — its
 * trailing catch converts every rejection into a resolved envelope — and the
 * generated `ServiceClient` passes no `onWarn`. So a `.catch()` alone
 * observes nothing but a synchronous throw, and a resolved failure would
 * otherwise vanish silently. Pinned by `transport.test.ts`'s
 * `'returns kind:network when fetch rejects with a non-abort error'` and
 * `'returns ok: false with parsed error fields on non-2xx'`.
 *
 * `status` is a real HTTP status only when `kind === 'http'`; it is `0`
 * otherwise, which is why `kind` is logged beside it. Only the guild id
 * identifies the event; the member's Discord id is left out by this file's
 * own convention (`00-critical.md` § Logging lists user ids as safe, so this
 * is stricter than the rule, not required by it).
 */
function warnIfReportFailed(
  result: GatewayResult<unknown>,
  guildId: string,
  message: string
): void {
  if (result.ok) {
    return;
  }
  logger.warn({ guildId, kind: result.kind, status: result.status, error: result.error }, message);
}

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
 * Subscribe to `guildMemberUpdate` and `guildMemberRemove`. Both require the
 * `GuildMembers` intent, which the client already declares — without it
 * neither listener is ever called, and the stored value falls back to
 * opportunistic refresh (or, for a departure, never gets removed at all).
 */
export function registerGuildMemberInfoReporter(client: Client): void {
  // Per-member chain of in-flight gateway reports, keyed by `${guildId}:${discordUserId}`.
  //
  // The two listeners below are independent fire-and-forget calls with nothing
  // ordering them per member. A departure's delete and a slower-resolving update
  // for the same member race independently, and only one resolution order is
  // safe: an update that resolves AFTER the departure's delete resurrects the
  // stale row, and nothing later corrects it, since a departed member emits no
  // further events (not verified: reasoned from Discord's event model, not
  // observed). The reverse order is self-healing — a rejoin naturally produces
  // another update. Chaining both listeners through this map, per member, makes
  // the delete always run after any update already in flight for that member.
  //
  // not verified: assumes a single bot-client replica — this map only orders
  // reports within one process; a second replica has its own independent chain.
  //
  // Pinned by the 'delays a same-member delete until a pending update resolves' test.
  const inFlight = new Map<string, Promise<void>>();

  function enqueueReport(
    key: string,
    guildId: string,
    message: string,
    report: () => Promise<GatewayResult<unknown>>
  ): void {
    const run = (): Promise<void> =>
      report()
        .then(result => {
          warnIfReportFailed(result, guildId, message);
        })
        .catch((err: unknown) => {
          logger.warn({ err, guildId }, message);
        });

    const prev = inFlight.get(key);
    const chain = prev === undefined ? run() : prev.then(run);
    inFlight.set(key, chain);
    void chain.finally(() => {
      if (inFlight.get(key) === chain) {
        inFlight.delete(key);
      }
    });
  }

  client.on(Events.GuildMemberUpdate, (before, after) => {
    if (after.user.bot || rendersIdentically(before, after)) {
      return;
    }

    enqueueReport(
      `${after.guild.id}:${after.id}`,
      after.guild.id,
      'Failed to report guild member update',
      () =>
        getServiceClient().recordGuildMemberInfo({
          guildId: after.guild.id,
          discordUserId: after.id,
          info: extractGuildInfoFromMember(after),
        })
    );
  });

  client.on(Events.GuildMemberRemove, member => {
    if (member.user.bot) {
      return;
    }

    enqueueReport(
      `${member.guild.id}:${member.id}`,
      member.guild.id,
      'Failed to report guild member removal',
      () =>
        getServiceClient().removeGuildMemberInfo({
          guildId: member.guild.id,
          discordUserId: member.id,
        })
    );
  });
}
