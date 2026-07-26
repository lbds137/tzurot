/**
 * The single home of the DM-permanent-failure → retention-column mapping.
 *
 * Two delivery pipelines report permanent DM failures — the release blast and
 * the retention warning notice — and both must stamp identically: 50278 (left
 * every shared server) / 50007 (DMs closed or bot blocked) → dm_undeliverable_since;
 * 10013 (Unknown User — the account is deleted) → discord_account_gone_at.
 * A second copy of this mapping is exactly the drift the single-predicate
 * rule (eligibility.ts) exists to prevent on the read side.
 *
 * NEVER 20026 (bot-wide quarantine): that code describes the BOT's state, not
 * the recipient's — keying on it would false-flag every user in one event.
 * The IS NULL guards record the FIRST failure only (a live streak never
 * advances the stamp); raw SQL keeps the columns off updated_at, the
 * dev<->prod sync LWW resolver.
 *
 * THROWS on database failure — swallow-vs-propagate is the caller's call:
 * the blast route swallows (its ledger row is already terminal, a 500 would
 * strand it), the notify report route propagates (its stamps ARE the terminal
 * transition, and the worker's retry makes a re-report safe via these same
 * idempotent guards).
 */

import { type PrismaClient } from '@tzurot/common-types/services/prisma';

/** Returns the number of rows actually stamped (0 = guarded no-op or unknown code). */
export async function stampDmPermanentFailure(
  prisma: PrismaClient,
  userId: string,
  errorCode: string | undefined
): Promise<number> {
  if (errorCode === '50278' || errorCode === '50007') {
    return prisma.$executeRaw`
      UPDATE users SET dm_undeliverable_since = NOW()
      WHERE id = ${userId}::uuid AND dm_undeliverable_since IS NULL
    `;
  }
  if (errorCode === '10013') {
    return prisma.$executeRaw`
      UPDATE users SET discord_account_gone_at = NOW()
      WHERE id = ${userId}::uuid AND discord_account_gone_at IS NULL
    `;
  }
  // Any other code (or none) stamps nothing: transient failures retry, and
  // unknown permanent codes must not guess at a user-state column.
  return 0;
}
