/**
 * Write-through of the guild memberships a turn's envelope happened to observe.
 *
 * `<participants>` renders each member's roles, colour and join date, but
 * roster MEMBERSHIP comes from DB history while that metadata comes from the
 * much shorter extended-context Discord fetch. A participant therefore keeps
 * their roster seat on a turn where the fetch missed them, and their
 * `<guild_info>` silently vanishes — three lines whose appearance and
 * disappearance evicted every cached prompt byte below them.
 *
 * Persisting what each turn DOES see is what lets a later turn render the same
 * bytes anyway. These functions are the observation half; the read half lives
 * in `MemoryRetriever`.
 *
 * Both take the recorder as a parameter rather than reaching for a client:
 * the assembler's `ContextDataSource` is a documented read-only seam, so the
 * write deliberately does not travel through it.
 */

import { INTERNAL_DISCORD_ID_PREFIX } from '@tzurot/common-types/constants/personaId';
import { type GuildMemberObservation } from '@tzurot/common-types/services/guildMemberInfoStore';
import { type GuildMemberInfo } from '@tzurot/common-types/types/schemas/discord';

/** The narrow write half of the guild-info store, as context assembly needs it. */
export interface GuildMemberInfoRecorder {
  /** Fails soft by contract — a cache write must never fail the turn it rides on. */
  record(guildId: string, observations: readonly GuildMemberObservation[]): Promise<void>;
}

/**
 * Persist the triggering message author's own guild membership.
 *
 * The one source available on EVERY turn its user speaks: it rides the
 * triggering message rather than the extended-context fetch window, so it is
 * what keeps an active participant's stored row genuinely fresh instead of
 * merely last-known.
 */
export async function recordActiveGuildInfo(
  recorder: GuildMemberInfoRecorder,
  guildId: string | null,
  userId: string,
  info: GuildMemberInfo | undefined
): Promise<void> {
  if (guildId === null || info === undefined) {
    return;
  }
  await recorder.record(guildId, [{ userId, info }]);
}

/**
 * Persist the extended-context fetch's observations of everyone ELSE.
 *
 * Covers the participants the active-speaker path cannot: a human who talks in
 * the channel without ever addressing the bot is never the active user, so
 * this is the only turn on which their membership is observable at all.
 *
 * Must be called BEFORE the shared resolver remaps the raw map's keys: the raw
 * keys are `discord:<snowflake>`, which `userMap` turns directly into internal
 * user ids. After the remap they are persona ids — the wrong key for a fact
 * about a HUMAN in a guild, and recovering the human from a persona would cost
 * a query this ordering avoids entirely.
 */
export async function recordParticipantGuildInfo(
  recorder: GuildMemberInfoRecorder,
  rawGuildInfo: Record<string, GuildMemberInfo> | undefined,
  guildId: string | null,
  userMap: Map<string, string>
): Promise<void> {
  if (guildId === null || rawGuildInfo === undefined) {
    return;
  }

  const observations: GuildMemberObservation[] = [];
  for (const [key, info] of Object.entries(rawGuildInfo)) {
    // Keys the resolver could not place are skipped rather than guessed at: a
    // discord id `userMap` did not provision (a bot, or a malformed snowflake)
    // has no user row to key on, and inventing one would attach a stranger's
    // roles to somebody else.
    const discordId = key.startsWith(INTERNAL_DISCORD_ID_PREFIX)
      ? key.slice(INTERNAL_DISCORD_ID_PREFIX.length)
      : key;
    const userId = userMap.get(discordId);
    if (userId !== undefined) {
      observations.push({ userId, info });
    }
  }

  await recorder.record(guildId, observations);
}
