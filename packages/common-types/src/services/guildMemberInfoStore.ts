/**
 * Persisted last-known Discord guild membership, keyed by (user, guild).
 *
 * Exists so `<participants>` renders identical bytes from one turn to the next.
 * `<guild_info>` used to be drawn solely from the per-turn extended-context
 * fetch while roster MEMBERSHIP came from DB history — two windows feeding one
 * block, so a participant kept their roster seat on a turn where the fetch
 * missed them and their guild metadata silently vanished. Three lines of role
 * metadata appearing and disappearing evicted the entire prompt prefix below
 * them (~78k characters of chat log, measured in prod).
 *
 * Two properties make that stop, and both are load-bearing:
 *
 * - **Write-through, with no expiry path.** This module exports exactly two
 *   operations — record and read — so the only way a row changes is a newer
 *   observation overwriting it. A TTL would be the same flicker on a slower
 *   clock, which is why adding one here would be a regression rather than
 *   housekeeping. (The row does still disappear if its USER row does: the FK
 *   cascades. That is deletion of the subject, not expiry of the value.)
 * - **Empty observations do not write.** Discord hands back an empty member on
 *   a cache miss, and storing that would clobber a good row with the very
 *   absence this module exists to paper over — see {@link isEmptyGuildInfo}.
 *
 * Shared rather than service-local because two Prisma-holding services observe
 * memberships from different angles: ai-worker sees them on the job envelope
 * (already resolved to internal user ids), and api-gateway receives them from
 * bot-client's `guildMemberUpdate` events. bot-client itself never touches
 * Prisma, so its half necessarily arrives through the gateway.
 */

import type { GuildMemberInfo } from '../types/schemas/discord.js';
import { createLogger } from '../utils/logger.js';
import type { PrismaClient } from '../generated/prisma/client.js';

const logger = createLogger('guildMemberInfoStore');

/** One user's membership in one guild, as observed. */
export interface GuildMemberObservation {
  /** Internal user UUID — never a Discord snowflake. */
  userId: string;
  info: GuildMemberInfo;
}

/**
 * True when an observation carries no membership facts at all.
 *
 * This is the "we looked and saw nothing" shape — `extractGuildInfo` returns
 * `{ roles: [] }` when `msg.member` is null — and it must never be written,
 * because it would replace a good stored row with the absence that causes the
 * flicker. It is distinguishable from a real member who merely holds no roles:
 * that member still carries `joinedAt`.
 *
 * The one case it CANNOT distinguish: a real member with no roles, no coloured
 * role, and a `joinedAt` Discord did not supply (the uncached-member edge case
 * the column's own schema comment names). That observation is indistinguishable
 * from having seen nothing, so it is dropped. Self-healing rather than
 * permanent — any later turn that resolves `joinedAt` writes the row — and the
 * failure direction is the safe one: a dropped write leaves the previous value
 * standing, where accepting it would erase one.
 */
export function isEmptyGuildInfo(info: GuildMemberInfo): boolean {
  return info.roles.length === 0 && info.displayColor === undefined && info.joinedAt === undefined;
}

/**
 * Write through every non-empty observation for one guild.
 *
 * Fails soft: this is a cache write on the generation hot path, so a database
 * problem degrades the next turn's rendering rather than failing the turn.
 */
export async function recordGuildMemberInfos(
  prisma: PrismaClient,
  guildId: string,
  observations: readonly GuildMemberObservation[]
): Promise<void> {
  const writable = observations.filter(o => !isEmptyGuildInfo(o.info));
  if (guildId === '' || writable.length === 0) {
    return;
  }

  try {
    await prisma.$transaction(
      writable.map(({ userId, info }) => {
        // Per-field write-back semantics differ on purpose. `roles` and
        // `displayColor` always write: an empty role list or an absent color
        // on an otherwise non-empty observation is a real state a member can
        // be in (role-less, colorless), so the new value wins. Not verified:
        // whether a partial member fetch can carry `joinedAt` while its role
        // cache is unresolved — if that shape exists at runtime, `roles`
        // inherits the same quality-vs-state ambiguity fixed for `joinedAt`
        // below, and this write needs the same treatment (revisit with a
        // runtime capture, not a code read). `joinedAt`
        // writes ONLY when the observation carries it: a join date can become
        // unknown only through observation quality (the uncached-member edge
        // the schema comment names), never through a state change — so
        // null-ing a stored value would erase a fact with the very absence
        // this module exists to paper over, and re-break the stable prompt
        // block on the next render.
        const base = {
          roles: info.roles,
          displayColor: info.displayColor ?? null,
        };
        const joinedAt = info.joinedAt !== undefined ? new Date(info.joinedAt) : null;
        return prisma.userGuildInfo.upsert({
          where: { userId_guildId: { userId, guildId } },
          create: { userId, guildId, ...base, joinedAt },
          update: {
            ...base,
            ...(info.joinedAt !== undefined ? { joinedAt } : {}),
          },
        });
      })
    );
  } catch (err) {
    logger.warn(
      { err, guildId, count: writable.length },
      'Failed to record guild member info; rendering falls back to the live fetch'
    );
  }
}

/**
 * Last-known membership for the given users in one guild, keyed by user id.
 *
 * Fails soft to an empty map — a read failure must leave rendering exactly
 * where it was before this store existed, not break the turn.
 */
export async function getGuildMemberInfos(
  prisma: PrismaClient,
  guildId: string,
  userIds: readonly string[]
): Promise<Map<string, GuildMemberInfo>> {
  const ids = [...new Set(userIds)].filter(id => id !== '');
  if (guildId === '' || ids.length === 0) {
    return new Map();
  }

  try {
    const rows = await prisma.userGuildInfo.findMany({
      where: { guildId, userId: { in: ids } },
      take: ids.length,
    });
    return new Map(
      rows.map(row => [
        row.userId,
        {
          roles: row.roles,
          // `?? undefined` rather than a spread guard: the schema's optional
          // fields are absent-or-present, and a null would render as the
          // string "null" if it ever reached the formatter.
          displayColor: row.displayColor ?? undefined,
          joinedAt: row.joinedAt?.toISOString(),
        },
      ])
    );
  } catch (err) {
    logger.warn({ err, guildId }, 'Failed to read guild member info; rendering without it');
    return new Map();
  }
}
