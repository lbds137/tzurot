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
 * - Private thread → `await channel.members.fetch(viewerId)`. A successful
 *   fetch is proof of membership: `members.fetch(id)` throws when the id is
 *   not a member and never resolves to null/undefined, so reaching the next
 *   line already proves membership.
 *
 *   The converse does NOT hold: a throw only proves the fetch failed, not
 *   that the viewer isn't a member. In particular, the catch cannot
 *   distinguish "the viewer is not a member" from "the BOT lacks permission
 *   to list this thread's members" (e.g. missing Manage Threads on our
 *   side) — a bot-side permission gap denies for a reason that has nothing
 *   to do with the viewer. Both outcomes deny here, which is consistent
 *   with fail-closed, but the false-negative surface is broader than the
 *   function name suggests.
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
