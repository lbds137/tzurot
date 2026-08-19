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
 * ONE shape, at every call site: the write runs, then {@link stampCardSourceHash}
 * stamps from the row it returned, both inside one transaction. Creates and
 * upserts use it as well as updates.
 *
 * An earlier draft inlined the digest into the CREATE payload, since a create
 * knows the whole card up front and could do it in a single write. That was
 * dropped for uniformity: an update genuinely cannot take that route — merging
 * the patch onto the stored row means either trusting a cast from Prisma's
 * update-input type or re-deriving the field-precedence logic the route already
 * implements (`displayName` mirroring `name`, for one), and both are silent
 * when wrong — so inlining creates would have bought one saved round trip on
 * the rare path in exchange for two shapes to keep correct.
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
