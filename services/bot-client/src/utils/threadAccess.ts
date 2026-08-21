/**
 * Private-thread membership gate.
 *
 * Threads carry no permission overwrites of their own — `channel.permissionsFor(...)`
 * on a thread resolves the PARENT channel's overwrites — while a private thread
 * layers an explicit member list on top of that. `ViewChannel` on the parent
 * therefore does NOT imply access to a private thread, and a viewer removed
 * from a private thread usually keeps `ViewChannel` on the parent. Any caller
 * that stops at a `permissionsFor`/`ViewChannel` check is silently wrong for
 * private threads specifically.
 */

import { type GuildTextBasedChannel, ChannelType } from 'discord.js';

/**
 * Whether `viewerId` satisfies the private-thread membership requirement for
 * `channel`. This is ONLY the thread half of an access check — callers still
 * need their own base permission check (e.g. `ViewChannel`) for the
 * non-thread/public-thread case, since public and announcement threads
 * inherit parent access and never reach the membership lookup here.
 *
 * - Not a thread → `true` (nothing further to check here).
 * - Public thread / announcement thread → `true`, without a lookup — they
 *   inherit parent access, so a private-thread-only membership list doesn't
 *   apply to them.
 * - Private thread → `await channel.members.fetch(viewerId)`, treating a
 *   successful fetch as proof of membership. That rests on two separate
 *   claims, each verified with a different instrument:
 *
 *   1. The single-snowflake overload resolves `Promise<ThreadMember>`, never
 *      `| null` — verified against the shipped discord.js 14.27.0 typings
 *      (`ThreadMemberManager.fetch(options: ThreadMemberResolvable |
 *      FetchThreadMemberOptions): Promise<ThreadMember>`). So there is no
 *      null-shaped success to mistake for a member.
 *   2. It THROWS for a non-member rather than resolving anything at all.
 *      Runtime-confirmed by a live probe on discord.js 14.27.0 against a
 *      real private thread: the non-member fetch threw
 *      `DiscordAPIError[10007] Unknown Member` (HTTP 404) — identically on
 *      an immediate retry, so no cache layer converts the miss into a
 *      resolve — while a member fetch resolved a `ThreadMember`. This is
 *      the claim the gate actually rests on: were a non-member fetch ever
 *      to RESOLVE, this returns `true` and the gate OPENS. The probe is an
 *      observation of current API behaviour, not a contract Discord
 *      publishes — but the claim is now observed, no longer inherited.
 *
 *   The converse of (2) does NOT hold, and nothing here claims it does: a
 *   throw only proves the fetch failed, not that the viewer isn't a member.
 *   The catch cannot distinguish "the viewer is not a member" from "the BOT
 *   lacks permission to list this thread's members" (e.g. missing Manage
 *   Threads on our side) — a bot-side gap denies for a reason having nothing
 *   to do with the viewer. Both outcomes deny, which is consistent with
 *   fail-closed, but the false-NEGATIVE surface is broader than the function
 *   name suggests.
 *
 * Fails closed (returns `false`) on any unexpected fetch failure.
 */
export async function satisfiesPrivateThreadMembership(
  channel: GuildTextBasedChannel,
  viewerId: string
): Promise<boolean> {
  if (!channel.isThread()) {
    return true;
  }

  if (channel.type !== ChannelType.PrivateThread) {
    return true;
  }

  try {
    await channel.members.fetch(viewerId);
    return true;
  } catch {
    return false;
  }
}
