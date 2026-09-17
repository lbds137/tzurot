/**
 * Recent-days digest: pending-row materialization + raw-SQL guarded writes.
 *
 * `persona_personality_digests` is derived data (never dev↔prod synced —
 * EXCLUDED_TABLES), so the sync-tracked `$executeRaw`-over-`update()` reason
 * `archiveSummaryStore.ts` documents does not apply here. Raw SQL is still
 * used for the SAME reason as that module's content guard: every write here
 * carries `requested_at IS NOT DISTINCT FROM $seenRequestedAt`, so a
 * `/history clear`/`purge` landing mid-generation resolves mechanically —
 * `clear` deletes the row (the UPDATE then hits 0 rows), and `purge` stamps
 * a fresh `requested_at` (the guard then fails and the pair stays pending for
 * the next sweep) — rather than silently overwriting either.
 */

import type { PrismaClient } from '@tzurot/common-types/services/prisma';
import { generatePersonaPersonalityDigestUuid } from '@tzurot/common-types/utils/deterministicUuid';
import {
  RECENT_DAYS_DIGEST,
  RECENT_DAYS_DIGEST_STATUS,
  type DigestFailureClass,
  type RecentDaysDigestStatus,
} from '@tzurot/common-types/constants/recentDaysDigest';

interface PairIdentity {
  personaId: string;
  personalityId: string;
}

function pairKey(pair: PairIdentity): string {
  return `${pair.personaId}:${pair.personalityId}`;
}

/**
 * For every pair with no existing digest row (`digestId === null`), insert a
 * `pending` row keyed by the pair's deterministic id, then re-read the id
 * every pair actually resolves to — a concurrent insert of the SAME
 * deterministic id (another sweep tick, a manual refresh) is a no-op under
 * `ON CONFLICT`, and re-reading rather than trusting the locally computed id
 * is what makes that race resolve correctly instead of silently.
 *
 * After this step every input pair has a row, so both `storeDigestSuccess`
 * and `recordDigestFailure` are guarded UPDATEs rather than upserts.
 */
export async function materializePendingRows(
  prisma: PrismaClient,
  pairs: (PairIdentity & { digestId: string | null })[]
): Promise<Map<string, string>> {
  for (const pair of pairs) {
    if (pair.digestId !== null) {
      continue;
    }
    const id = generatePersonaPersonalityDigestUuid(pair.personaId, pair.personalityId);
    await prisma.$executeRaw`
      INSERT INTO persona_personality_digests
        (id, persona_id, personality_id, digest_status, created_at, updated_at)
      VALUES (${id}::uuid, ${pair.personaId}::uuid, ${pair.personalityId}::uuid, ${RECENT_DAYS_DIGEST_STATUS.PENDING}, NOW(), NOW())
      ON CONFLICT (persona_id, personality_id) DO NOTHING
    `;
  }

  const ids = new Map<string, string>();
  for (const pair of pairs) {
    if (pair.digestId !== null) {
      ids.set(pairKey(pair), pair.digestId);
      continue;
    }
    const rows = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM persona_personality_digests
      WHERE persona_id = ${pair.personaId}::uuid AND personality_id = ${pair.personalityId}::uuid
    `;
    const row = rows[0];
    if (row !== undefined) {
      ids.set(pairKey(pair), row.id);
    }
  }
  return ids;
}

/** Read back a row's current status — used by the sweep only to classify its
 *  own stats (`failed` vs `dead`) after a `recordDigestFailure` write;
 *  never needed to decide the write itself, which is entirely SQL-side. */
export async function readDigestStatus(
  prisma: PrismaClient,
  id: string
): Promise<RecentDaysDigestStatus | null> {
  const rows = await prisma.$queryRaw<{ digest_status: RecentDaysDigestStatus | null }[]>`
    SELECT digest_status FROM persona_personality_digests WHERE id = ${id}::uuid
  `;
  return rows[0]?.digest_status ?? null;
}

export interface StoreDigestSuccessInput {
  id: string;
  seenRequestedAt: Date | null;
  text: string;
  model: string;
  promptVersion: number;
  sourceWatermark: Date;
  windowStart: Date;
  sourceRowCount: number;
  sourceRowIds: string[];
  sourceEpoch: Date | null;
}

/** Write a successful generation. The `requested_at` guard resolves to 0
 *  affected rows when a purge stamped the row (or deleted it) between
 *  selection and this write; the caller reads that from the returned count. */
export async function storeDigestSuccess(
  prisma: PrismaClient,
  input: StoreDigestSuccessInput
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE persona_personality_digests
    SET digest_text = ${input.text}, digest_status = 'done', digest_model = ${input.model},
        digest_prompt_version = ${input.promptVersion}, source_watermark = ${input.sourceWatermark}::timestamptz,
        window_start = ${input.windowStart}::timestamptz, source_row_count = ${input.sourceRowCount},
        source_row_ids = ${input.sourceRowIds}::text[], source_epoch = ${input.sourceEpoch},
        generated_at = NOW(), digest_attempts = 0, last_error = NULL, updated_at = NOW()
    WHERE id = ${input.id}::uuid AND requested_at IS NOT DISTINCT FROM ${input.seenRequestedAt}
  `;
}

export interface RecordDigestFailureInput {
  id: string;
  seenRequestedAt: Date | null;
  attemptedWatermark: Date | null;
  promptVersion: number;
  errorClass: DigestFailureClass;
}

/**
 * Write a BILLED failure. `digest_attempts` and `digest_status` are computed
 * from the SAME CASE expression so they can never disagree. Three billed
 * failures against the same watermark **and** prompt version, on a row not
 * currently `pending`, mark the row `dead`; a watermark move, a version bump,
 * or a purge/refresh (which sets the row `pending`) each restart the count at
 * 1 — the `digest_status <> 'pending'` arm is what stops a purge-marked pair
 * that already sat at the attempt cap from being unable to ever restart.
 */
export async function recordDigestFailure(
  prisma: PrismaClient,
  input: RecordDigestFailureInput
): Promise<number> {
  return prisma.$executeRaw`
    UPDATE persona_personality_digests
    -- attempt-count CASE (1 of 2): its twin decides digest_status below; edit both.
    SET digest_attempts = CASE
          WHEN source_watermark IS NOT DISTINCT FROM ${input.attemptedWatermark}
           AND digest_prompt_version IS NOT DISTINCT FROM ${input.promptVersion}
           AND digest_status <> 'pending'
          THEN digest_attempts + 1 ELSE 1 END,
        source_watermark = ${input.attemptedWatermark},
        digest_prompt_version = ${input.promptVersion},
        last_error = ${input.errorClass},
        -- attempt-count CASE (2 of 2): must stay textually identical to the one above.
        digest_status = CASE
          WHEN (CASE
                  WHEN source_watermark IS NOT DISTINCT FROM ${input.attemptedWatermark}
                   AND digest_prompt_version IS NOT DISTINCT FROM ${input.promptVersion}
                   AND digest_status <> 'pending'
                  THEN digest_attempts + 1 ELSE 1 END) >= ${RECENT_DAYS_DIGEST.MAX_ATTEMPTS}
          THEN 'dead' ELSE 'failed' END,
        updated_at = NOW()
    WHERE id = ${input.id}::uuid AND requested_at IS NOT DISTINCT FROM ${input.seenRequestedAt}
  `;
}
