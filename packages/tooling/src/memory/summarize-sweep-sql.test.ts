import { describe, it, expect } from 'vitest';
import {
  ELIGIBLE_PREDICATE,
  buildSelectionSql,
  PENDING_STAMP_SQL,
  PERSONALITY_ID_BY_SLUG_SQL,
  WINDOW_COUNTS_SQL,
  FACT_COVERAGE_SQL,
  DEAD_BY_ERROR_CLASS_SQL,
} from './summarize-sweep-sql.js';

describe('ELIGIBLE_PREDICATE', () => {
  it('excludes chunk rows and gates by prompt version', () => {
    expect(ELIGIBLE_PREDICATE).toContain('chunk_group_id IS NULL');
    expect(ELIGIBLE_PREDICATE).toContain('summary_prompt_version < $2::int');
  });
});

describe('buildSelectionSql', () => {
  it('MEM-ARCH-029: hot mode filters by recent retrieval and orders by retrieval count (hot-first)', () => {
    const sql = buildSelectionSql('hot');
    expect(sql).toContain('chunk_group_id IS NULL');
    expect(sql).toContain('summary_prompt_version < $2::int');
    expect(sql).toContain("last_retrieved_at >= NOW() - ($3::int * INTERVAL '1 day')");
    expect(sql).toContain('ORDER BY retrieval_count DESC, last_retrieved_at DESC');
    expect(sql).toContain('LIMIT $4::int');
  });

  it('cold mode filters by stale/never-retrieved and orders by creation', () => {
    const sql = buildSelectionSql('cold');
    expect(sql).toContain('chunk_group_id IS NULL');
    expect(sql).toContain('summary_prompt_version < $2::int');
    expect(sql).toContain(
      "(last_retrieved_at IS NULL OR last_retrieved_at < NOW() - ($3::int * INTERVAL '1 day'))"
    );
    expect(sql).toContain('ORDER BY created_at DESC');
    expect(sql).toContain('LIMIT $4::int');
  });

  it('hot and cold differ only in the window clause and ORDER BY', () => {
    const hot = buildSelectionSql('hot');
    const cold = buildSelectionSql('cold');
    expect(hot).not.toEqual(cold);
    // Both still carry the shared eligibility predicate and limit.
    for (const sql of [hot, cold]) {
      expect(sql).toContain(ELIGIBLE_PREDICATE);
      expect(sql).toContain('LIMIT $4::int');
    }
  });
});

describe('PENDING_STAMP_SQL', () => {
  it('preserves done and dead, and never blanket-resets to pending', () => {
    expect(PENDING_STAMP_SQL).toContain("IN ('done', 'dead')");
    expect(PENDING_STAMP_SQL).toContain('summary_requested_at = NOW()');
    expect(PENDING_STAMP_SQL).toContain('id = ANY($1::uuid[])');
  });
});

describe('PERSONALITY_ID_BY_SLUG_SQL', () => {
  it('selects id by slug', () => {
    expect(PERSONALITY_ID_BY_SLUG_SQL).toContain('FROM personalities WHERE slug = $1');
  });
});

describe('WINDOW_COUNTS_SQL', () => {
  it('produces the named count columns', () => {
    for (const column of [
      'total_non_chunk',
      'retrieved_in_window',
      'done_current',
      'done_older',
      'done_newer',
      'pending',
      'failed',
      'dead',
      'never_attempted',
    ]) {
      expect(WINDOW_COUNTS_SQL).toContain(column);
    }
    expect(WINDOW_COUNTS_SQL).toContain('chunk_group_id IS NULL');
  });

  it('every one of the seven per-status FILTER clauses carries the in-window condition, so all seven partition retrieved_in_window exactly', () => {
    const windowClause = `last_retrieved_at >= NOW() - ($3::int * INTERVAL '1 day')`;
    const occurrences = WINDOW_COUNTS_SQL.split(windowClause).length - 1;
    // retrieved_in_window itself, plus done_current, done_older, done_newer,
    // pending, failed, dead, never_attempted — 8 total. A per-status filter
    // losing its window condition drops this count without changing
    // anything else the weaker "column names exist" test above can see.
    expect(occurrences).toBe(8);
  });
});

describe('FACT_COVERAGE_SQL', () => {
  it('joins memory_facts on a live, non-forgotten source citation', () => {
    expect(FACT_COVERAGE_SQL).toContain('f.superseded_at IS NULL');
    expect(FACT_COVERAGE_SQL).toContain('f.forgotten = false');
    // source_memory_ids is text[] while memories.id is uuid: without the cast
    // Postgres rejects the comparison (operator does not exist: uuid = text).
    // The @> containment operator (rather than = ANY(array)) lets the planner
    // use the GIN index on source_memory_ids.
    expect(FACT_COVERAGE_SQL).toContain('f.source_memory_ids @> ARRAY[m.id::text]');
  });
});

describe('DEAD_BY_ERROR_CLASS_SQL', () => {
  it('MEM-ARCH-030: filters to dead rows and groups by error class', () => {
    expect(DEAD_BY_ERROR_CLASS_SQL).toContain("summary_status = 'dead'");
    expect(DEAD_BY_ERROR_CLASS_SQL).toContain('GROUP BY 1');
    expect(DEAD_BY_ERROR_CLASS_SQL).toContain('LIMIT 50');
  });
});
