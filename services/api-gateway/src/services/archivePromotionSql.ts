/**
 * Memory-archive auto-promotion — SQL text, split out of `archivePromotion.ts`
 * purely to keep that file under the `max-lines` limit.
 *
 * The eligibility rule (`summary_status`/`summary_prompt_version`) mirrors
 * the sibling `WINDOW_COUNTS_SQL` in
 * `packages/tooling/src/memory/summarize-sweep-sql.ts`, grouped over every
 * personality instead of one — the two must move together whenever it
 * changes. The coverage-WINDOW handling diverges: the sibling keeps the
 * window inside its `FILTER` clauses because it also reports an un-windowed
 * total alongside them, so each aggregate there needs its own choice of
 * whether the window applies. This query has no such un-windowed column —
 * every aggregate here is window-scoped — so the window is instead a plain
 * row filter in `WHERE`, which bounds the scan to the window itself rather
 * than filtering aggregates computed over the whole table.
 *
 * Rows are ordered most-retrieved first, so the `LIMIT` cap drops the least
 * active personalities rather than an arbitrary slice.
 */

/** Bounded-query cap: at most this many personalities are evaluated per run. */
export const MAX_PERSONALITIES_EVALUATED = 1000;

/**
 * Per-personality coverage counts. Params: `$1` = current summarizer prompt
 * version, `$2` = coverage window in days, `$3` = row limit.
 */
export const ARCHIVE_COVERAGE_SQL = `SELECT personality_id::text AS personality_id,
  COUNT(*)::int AS retrieved_in_window,
  COUNT(*) FILTER (
    WHERE summary_status = 'done'
      AND summary_prompt_version = $1::int
  )::int AS done_current
FROM memories
WHERE chunk_group_id IS NULL
  AND last_retrieved_at >= NOW() - ($2::int * INTERVAL '1 day')
GROUP BY personality_id
ORDER BY retrieved_in_window DESC, personality_id
LIMIT $3::int`;

/** One row of {@link ARCHIVE_COVERAGE_SQL}. */
export interface ArchiveCoverageRow {
  personality_id: string;
  retrieved_in_window: number;
  done_current: number;
}
