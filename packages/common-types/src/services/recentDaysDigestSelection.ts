/**
 * Recent-days digest: the candidate selection query — ONE source of truth.
 *
 * Both the ai-worker sweep and the tooling `digest:candidates` dry-run need
 * the exact same "which (persona, personality) pairs are due" logic, and
 * `packages/tooling` depends on common-types but not on `ai-worker` or
 * `conversation-history` — so this is the only package both callers can
 * import, and the only place the SQL is allowed to live. Duplicating it would
 * let the dry-run drift from what the sweep actually generates.
 */

import type { PrismaClient } from './prisma.js';
import {
  RECENT_DAYS_DIGEST,
  RECENT_DAYS_DIGEST_STATUS,
  type RecentDaysDigestStatus,
} from '../constants/recentDaysDigest.js';

/** One (persona, personality) pair due for a digest generation, plus every
 *  field the prompt builder and the store need to act on it. */
export interface DigestCandidatePair {
  personaId: string;
  personalityId: string;
  personalitySlug: string;
  ownerId: string;
  ownerTimezone: string;
  personaName: string;
  personaPreferredName: string | null;
  personalityName: string;
  personalityDisplayName: string | null;
  epoch: Date | null;
  newestRowAt: Date;
  windowRowCount: number;
  digestId: string | null;
  digestStatus: RecentDaysDigestStatus | null;
  digestAttempts: number | null;
  sourceWatermark: Date | null;
  generatedAt: Date | null;
  requestedAt: Date | null;
}

export interface SelectDigestCandidatePairsInput {
  personalitySlugs: string[];
  promptVersion: number;
  limit: number;
  now?: Date;
}

interface RawCandidateRow {
  persona_id: string;
  personality_id: string;
  personality_slug: string;
  owner_id: string;
  owner_timezone: string;
  persona_name: string;
  persona_preferred_name: string | null;
  personality_name: string;
  personality_display_name: string | null;
  epoch: Date | null;
  newest_row_at: Date;
  window_row_count: bigint | number;
  digest_id: string | null;
  digest_status: RecentDaysDigestStatus | null;
  digest_attempts: number | null;
  source_watermark: Date | null;
  generated_at: Date | null;
  requested_at: Date | null;
}

/** Map one raw SQL row to the camelCase pair shape, coercing the
 *  `COUNT(*)`-derived `window_row_count` (bigint in Postgres) to a number. */
function toCandidatePair(row: RawCandidateRow): DigestCandidatePair {
  return {
    personaId: row.persona_id,
    personalityId: row.personality_id,
    personalitySlug: row.personality_slug,
    ownerId: row.owner_id,
    ownerTimezone: row.owner_timezone,
    personaName: row.persona_name,
    personaPreferredName: row.persona_preferred_name,
    personalityName: row.personality_name,
    personalityDisplayName: row.personality_display_name,
    epoch: row.epoch,
    newestRowAt: row.newest_row_at,
    windowRowCount: Number(row.window_row_count),
    digestId: row.digest_id,
    digestStatus: row.digest_status,
    digestAttempts: row.digest_attempts,
    sourceWatermark: row.source_watermark,
    generatedAt: row.generated_at,
    requestedAt: row.requested_at,
  };
}

/**
 * Select up to `limit` (persona, personality) pairs due for a digest
 * generation, ordered purge/refresh first, then never-generated, then
 * oldest-generated-first.
 *
 * A pair is due when: the personality's slug is in `personalitySlugs`; at
 * least one non-deleted `conversation_history` row falls inside the window
 * (and past the pair's epoch, when one is active); the pair either has no
 * digest row, has new rows past its watermark, was manually requested since
 * its last generation, or was generated under a different prompt version;
 * AND (for a routine, non-refresh regeneration) at least
 * `MIN_REGEN_INTERVAL_MS` has passed since the last generation. A `dead` pair
 * is re-admitted only by new source rows past its watermark or a prompt-version
 * bump. An explicit refresh also re-admits it, but indirectly: `digest:refresh`
 * and the history purge hook both set `digest_status = 'pending'` alongside the
 * stamp, so the row is no longer `dead` by the time the next tick selects. A
 * leftover `requested_at` on a row that STAYED `dead` is exactly the
 * re-admission this group closes.
 */
export async function selectDigestCandidatePairs(
  prisma: PrismaClient,
  input: SelectDigestCandidatePairsInput
): Promise<DigestCandidatePair[]> {
  const { personalitySlugs, promptVersion, limit } = input;
  if (personalitySlugs.length === 0) {
    return [];
  }
  const now = input.now ?? new Date();
  const windowStart = new Date(now.getTime() - RECENT_DAYS_DIGEST.WINDOW_DAYS * 86_400_000);
  const regenCutoff = new Date(now.getTime() - RECENT_DAYS_DIGEST.MIN_REGEN_INTERVAL_MS);

  const rows = await prisma.$queryRaw<RawCandidateRow[]>`
    WITH candidate_rows AS (
      SELECT ch.persona_id, ch.personality_id, ch.created_at
      FROM conversation_history ch
      JOIN personalities pl ON pl.id = ch.personality_id
      JOIN personas pa ON pa.id = ch.persona_id
      LEFT JOIN user_persona_history_configs cfg
        ON cfg.user_id = pa.owner_id
       AND cfg.personality_id = ch.personality_id
       AND cfg.persona_id = ch.persona_id
      WHERE pl.slug = ANY(${personalitySlugs}::text[])
        AND ch.deleted_at IS NULL
        AND ch.created_at >= ${windowStart}::timestamptz
        AND (cfg.last_context_reset IS NULL OR ch.created_at >= cfg.last_context_reset)
    ),
    pairs AS (
      SELECT persona_id, personality_id,
             MAX(created_at) AS newest_row_at,
             COUNT(*) AS window_row_count
      FROM candidate_rows
      GROUP BY persona_id, personality_id
    )
    SELECT
      pa.id AS persona_id,
      pl.id AS personality_id,
      pl.slug AS personality_slug,
      pa.owner_id AS owner_id,
      u.timezone AS owner_timezone,
      pa.name AS persona_name,
      pa.preferred_name AS persona_preferred_name,
      pl.name AS personality_name,
      pl.display_name AS personality_display_name,
      cfg.last_context_reset AS epoch,
      pairs.newest_row_at AS newest_row_at,
      pairs.window_row_count AS window_row_count,
      d.id AS digest_id,
      d.digest_status AS digest_status,
      d.digest_attempts AS digest_attempts,
      d.source_watermark AS source_watermark,
      d.generated_at AS generated_at,
      d.requested_at AS requested_at
    FROM pairs
    JOIN personas pa ON pa.id = pairs.persona_id
    JOIN personalities pl ON pl.id = pairs.personality_id
    JOIN users u ON u.id = pa.owner_id
    LEFT JOIN user_persona_history_configs cfg
      ON cfg.user_id = pa.owner_id
     AND cfg.personality_id = pairs.personality_id
     AND cfg.persona_id = pairs.persona_id
    LEFT JOIN persona_personality_digests d
      ON d.persona_id = pairs.persona_id AND d.personality_id = pairs.personality_id
    WHERE
      (
        d.id IS NULL
        OR pairs.newest_row_at > d.source_watermark
        OR d.source_watermark IS NULL
        OR d.requested_at > COALESCE(d.generated_at, '-infinity'::timestamptz)
        OR d.digest_prompt_version IS DISTINCT FROM ${promptVersion}
      )
      AND (
        d.generated_at IS NULL
        OR d.generated_at < ${regenCutoff}::timestamptz
        OR d.requested_at > d.generated_at
      )
      AND (
        d.digest_status IS DISTINCT FROM ${RECENT_DAYS_DIGEST_STATUS.DEAD}
        OR pairs.newest_row_at > d.source_watermark
        OR d.digest_prompt_version IS DISTINCT FROM ${promptVersion}
      )
    ORDER BY
      COALESCE(d.requested_at > COALESCE(d.generated_at, '-infinity'::timestamptz), false) DESC,
      (d.id IS NULL) DESC,
      d.generated_at ASC NULLS FIRST
    LIMIT ${limit}
  `;

  return rows.map(toCandidatePair);
}
