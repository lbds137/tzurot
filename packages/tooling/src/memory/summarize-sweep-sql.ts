/**
 * Archive-summary pre-warm sweep — SQL text builders.
 *
 * Pure string builders, no I/O. Every list query below is bounded (a LIMIT
 * or a single-row aggregate), and the report path prints counts and ids
 * only — never memory or summary text.
 */

/**
 * The eligibility WHERE fragment: params `$1` = personality id (uuid),
 * `$2` = current prompt version (int).
 *
 * Twin of `summaryRefreshEligible` in
 * `services/ai-worker/src/utils/memoryUtils.ts` — the two must move
 * together whenever the eligibility rule changes.
 *
 * The version arm is NOT byte-identical to the twin: the twin treats any
 * `summary_prompt_version !== current` as stale, while this predicate uses
 * `<`. That's deliberate — a row stamped with a FUTURE prompt version (a
 * summary written by a newer prompt than this sweep knows about) must not
 * be re-billed here, even though ai-worker's own idempotence check would
 * treat it as stale on write.
 */
export const ELIGIBLE_PREDICATE = `personality_id = $1::uuid
    AND chunk_group_id IS NULL
    AND (
      summary_status IS NULL
      OR summary_status = 'failed'
      OR (summary_status IN ('done', 'dead') AND summary_prompt_version < $2::int)
    )`;

export type SweepMode = 'hot' | 'cold';

/**
 * Selection query for one sweep mode. Params: `$1` personality id, `$2`
 * prompt version, `$3` window days, `$4` limit.
 */
export function buildSelectionSql(mode: SweepMode): string {
  const windowClause =
    mode === 'hot'
      ? `AND last_retrieved_at >= NOW() - ($3::int * INTERVAL '1 day')
    ORDER BY retrieval_count DESC, last_retrieved_at DESC`
      : `AND (last_retrieved_at IS NULL OR last_retrieved_at < NOW() - ($3::int * INTERVAL '1 day'))
    ORDER BY created_at DESC`;

  return `SELECT id, length(content) AS content_chars
  FROM memories
  WHERE ${ELIGIBLE_PREDICATE}
    ${windowClause}
  LIMIT $4::int`;
}

/**
 * Batched pending stamp — a deliberate twin of the single-row stamp in
 * `ArchiveSummaryTrigger.enqueue`: `done` and `dead` are terminal and are
 * never re-admitted by this stamp either. Batched over an id array here
 * (param `$1`) rather than one row at a time. Raw SQL because `memories`
 * is sync-tracked and a Prisma client-level write would bump `updated_at`,
 * which the dev/prod sync's last-write-wins reconciliation reads as a
 * genuine edit.
 */
export const PENDING_STAMP_SQL = `UPDATE memories
SET summary_status = CASE WHEN summary_status IN ('done', 'dead') THEN summary_status ELSE 'pending' END,
    summary_requested_at = NOW()
WHERE id = ANY($1::uuid[])`;

/** Resolve a personality slug to its id. Param `$1` = slug. */
export const PERSONALITY_ID_BY_SLUG_SQL = `SELECT id FROM personalities WHERE slug = $1 LIMIT 1`;

/**
 * One row of window counts for the report. Params: `$1` personality id,
 * `$2` prompt version, `$3` window days.
 *
 * All seven per-status counts carry the SAME in-window condition as
 * `retrieved_in_window` — the report prints them as "of the rows retrieved
 * in the window", so every one of the seven must partition that same
 * denominator, never the personality's whole non-chunk set. `done_older`
 * (re-sweepable under `ELIGIBLE_PREDICATE`) and `done_newer` (a future
 * prompt version this sweep must not re-bill, per `ELIGIBLE_PREDICATE`'s
 * own comment) split what used to be a single `done_stale` bucket; a
 * `done` row with a NULL `summary_prompt_version` falls into neither
 * bucket, matching `ELIGIBLE_PREDICATE`'s own `<` comparison, which is
 * also NULL-false and so never re-admits such a row.
 */
export const WINDOW_COUNTS_SQL = `SELECT
  COUNT(*)::int AS total_non_chunk,
  COUNT(*) FILTER (WHERE last_retrieved_at >= NOW() - ($3::int * INTERVAL '1 day'))::int AS retrieved_in_window,
  COUNT(*) FILTER (
    WHERE last_retrieved_at >= NOW() - ($3::int * INTERVAL '1 day')
      AND summary_status = 'done'
      AND summary_prompt_version = $2::int
  )::int AS done_current,
  COUNT(*) FILTER (
    WHERE last_retrieved_at >= NOW() - ($3::int * INTERVAL '1 day')
      AND summary_status = 'done'
      AND summary_prompt_version < $2::int
  )::int AS done_older,
  COUNT(*) FILTER (
    WHERE last_retrieved_at >= NOW() - ($3::int * INTERVAL '1 day')
      AND summary_status = 'done'
      AND summary_prompt_version > $2::int
  )::int AS done_newer,
  COUNT(*) FILTER (
    WHERE last_retrieved_at >= NOW() - ($3::int * INTERVAL '1 day')
      AND summary_status = 'pending'
  )::int AS pending,
  COUNT(*) FILTER (
    WHERE last_retrieved_at >= NOW() - ($3::int * INTERVAL '1 day')
      AND summary_status = 'failed'
  )::int AS failed,
  COUNT(*) FILTER (
    WHERE last_retrieved_at >= NOW() - ($3::int * INTERVAL '1 day')
      AND summary_status = 'dead'
  )::int AS dead,
  COUNT(*) FILTER (
    WHERE last_retrieved_at >= NOW() - ($3::int * INTERVAL '1 day')
      AND summary_status IS NULL
  )::int AS never_attempted
FROM memories
WHERE personality_id = $1::uuid AND chunk_group_id IS NULL`;

/**
 * Fact coverage: how many in-window non-chunk rows are cited by a live
 * fact's source_memory_ids. Params: `$1` personality id, `$2` window days.
 */
export const FACT_COVERAGE_SQL = `SELECT COUNT(*)::int AS covered
FROM memories m
WHERE m.personality_id = $1::uuid
  AND m.chunk_group_id IS NULL
  AND m.last_retrieved_at >= NOW() - ($2::int * INTERVAL '1 day')
  AND EXISTS (
    SELECT 1 FROM memory_facts f
    WHERE f.personality_id = m.personality_id
      AND f.superseded_at IS NULL
      AND f.forgotten = false
      -- source_memory_ids is text[] (memory.id is uuid); @> lets the planner
      -- use the GIN index on source_memory_ids, unlike = ANY(array).
      AND f.source_memory_ids @> ARRAY[m.id::text]
  )`;

/**
 * Dead rows grouped by error class. Param `$1` = personality id.
 * `summary_last_error` is `VARCHAR(40)` — an error CLASS, never free text —
 * so grouping and printing it never leaks memory or summary content.
 */
export const DEAD_BY_ERROR_CLASS_SQL = `SELECT COALESCE(summary_last_error, 'unrecorded') AS error_class, COUNT(*)::int AS row_count
FROM memories
WHERE personality_id = $1::uuid AND chunk_group_id IS NULL AND summary_status = 'dead'
GROUP BY 1
ORDER BY 2 DESC, 1 ASC
LIMIT 50`;
