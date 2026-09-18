/**
 * Recent-days digest: the stale-row retention sweep.
 *
 * The render gate (`selectRenderableDigestText`) returns nothing once a row's
 * `generated_at` is older than WINDOW_DAYS, and the selection query never
 * picks up a pair with no `conversation_history` rows left inside the window —
 * so a quiet pair's row sits holding model-derived text that nothing reads and
 * nothing refreshes. This daily sweep deletes those rows.
 *
 * Deleting rather than nulling the text follows `/history clear`: when rows
 * for the pair come back, `materializePendingRows` re-inserts a fresh pending
 * row under the pair's deterministic id, so a delete costs one regeneration,
 * never a permanent loss.
 *
 * The in-window guard is deliberately a SUPERSET of the selection query's
 * predicate — no epoch, no `deleted_at`, no role filter — so ANY row inside
 * the window protects the digest. A wider protection set can only delete
 * fewer rows, never more, so the sweep errs toward keeping a digest the
 * generator might still refresh.
 *
 * Raw SQL rather than `deleteMany`: `conversation_history` is not a relation
 * of this model (only `persona` and `personality` are), so the query API has
 * no way to correlate on the PAIR in one statement. The table is in
 * EXCLUDED_TABLES, so bypassing Prisma's `@updatedAt` costs nothing here.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { RECENT_DAYS_DIGEST } from '@tzurot/common-types/constants/recentDaysDigest';
import { createLogger } from '@tzurot/common-types/utils/logger';

const logger = createLogger('recent-days-digest-retention');

const MS_PER_DAY = 86_400_000;

export interface RecentDaysDigestRetentionResult {
  /** Rows deleted by this run. */
  deletedCount: number;
  /** Rows generated strictly before this instant were candidates. */
  cutoff: Date;
  /** Wall-clock duration of the sweep. */
  durationMs: number;
}

/**
 * Delete every digest row generated before the cutoff whose pair has no
 * `conversation_history` row inside the current window. Runs whether or not
 * the `recentDaysDigestEnabled` system setting is on — retention is not gated
 * on generation. A purge-marked `pending` row keeps its old `generated_at`, so
 * it can be swept before any regeneration; with no source rows in window there
 * is nothing to regenerate, and the next selection re-materializes the row
 * (the store's materialize path, pinned by its component test).
 */
export async function sweepStaleRecentDaysDigests(
  prisma: PrismaClient
): Promise<RecentDaysDigestRetentionResult> {
  const startTime = Date.now();
  const windowStart = new Date(startTime - RECENT_DAYS_DIGEST.WINDOW_DAYS * MS_PER_DAY);
  const cutoff = new Date(
    startTime -
      (RECENT_DAYS_DIGEST.WINDOW_DAYS + RECENT_DAYS_DIGEST.STALE_SWEEP_GRACE_DAYS) * MS_PER_DAY
  );

  const deletedCount = await prisma.$executeRaw`
    DELETE FROM persona_personality_digests d
    WHERE d.generated_at IS NOT NULL
      AND d.generated_at < ${cutoff}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM conversation_history ch
        WHERE ch.persona_id = d.persona_id
          AND ch.personality_id = d.personality_id
          AND ch.created_at >= ${windowStart}::timestamptz
      )
  `;

  const durationMs = Date.now() - startTime;
  logger.info(
    { deletedCount, cutoff: cutoff.toISOString(), durationMs },
    'Recent-days digest retention sweep complete'
  );

  return { deletedCount, cutoff, durationMs };
}
