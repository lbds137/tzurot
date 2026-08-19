/**
 * Stamping `personalities.card_source_hash` — the write-side half of roster
 * blurb staleness.
 *
 * Every path that can change a character card records the card's digest as
 * part of that change, which is what lets the reader side ask
 * `roster_blurb_source_hash IS DISTINCT FROM card_source_hash` in SQL and get
 * an exact answer. Nothing downstream ever rehashes a card to discover that it
 * moved.
 *
 * Two shapes, because creates and updates have genuinely different safe forms:
 *
 *  - A CREATE knows the whole card up front, so it computes the digest with
 *    {@link hashRosterBlurbCard} and includes it in the same insert. One write,
 *    atomically consistent, nothing to reconcile.
 *  - An UPDATE only carries a patch. Merging that patch onto the stored row by
 *    hand means either trusting a cast from Prisma's update-input type or
 *    re-deriving the same field-precedence logic the route already implements
 *    (`displayName` mirroring `name`, for one) — both silent when wrong. So an
 *    update stamps AFTER the fact via {@link stampCardSourceHash}, from the row
 *    the write returned, which is the state that actually landed.
 *
 * The parameter type is the enforcement. `RosterBlurbCard` requires EVERY card
 * field, so a caller whose `select` omits one fails to compile rather than
 * hashing it as absent and stamping a digest no generation can ever match.
 */

import { hashRosterBlurbCard, type RosterBlurbCard } from '../utils/rosterBlurbCard.js';
import type { PrismaClient } from './prisma.js';

/** The subset of a Prisma client this needs — also what a transaction exposes. */
type RawWriter = Pick<PrismaClient, '$executeRaw'>;

/**
 * Stamp the digest of `card` onto an already-written personality row.
 *
 * RAW SQL, like the blurb write itself: `personalities` is sync-tracked and
 * reconciled last-write-wins on `updated_at` (`.claude/rules/03-database.md`
 * § Sync-Tracked Tables). The card edit that preceded this call legitimately
 * bumps that stamp; this derived follow-up write must not bump it a second
 * time and re-win a race it has no business winning.
 *
 * Run it in the SAME transaction as the write it describes wherever the caller
 * can. Outside one, a crash in the gap leaves the row unstamped, and nothing
 * downstream can tell that from a card that simply has not changed.
 */
export async function stampCardSourceHash(
  prisma: RawWriter,
  personalityId: string,
  card: RosterBlurbCard
): Promise<void> {
  await prisma.$executeRaw`
    UPDATE personalities
    SET card_source_hash = ${hashRosterBlurbCard(card)}
    WHERE id = ${personalityId}::uuid
  `;
}
