import { describe, it, expect } from 'vitest';
import { ARCHIVE_COVERAGE_SQL, MAX_PERSONALITIES_EVALUATED } from './archivePromotionSql.js';

describe('ARCHIVE_COVERAGE_SQL', () => {
  it('groups by personality_id', () => {
    expect(ARCHIVE_COVERAGE_SQL).toContain('GROUP BY personality_id');
  });

  it('counts every surviving row as retrieved_in_window — the window is a row filter, not a FILTER arm', () => {
    expect(ARCHIVE_COVERAGE_SQL).toContain('COUNT(*)::int AS retrieved_in_window');
  });

  it('carries the done_current predicate arm, gated on the current prompt version', () => {
    expect(ARCHIVE_COVERAGE_SQL).toContain(`COUNT(*) FILTER (
    WHERE summary_status = 'done'
      AND summary_prompt_version = $1::int
  )::int AS done_current`);
  });

  it('scopes the scan to the coverage window in the WHERE clause', () => {
    expect(ARCHIVE_COVERAGE_SQL).toContain(`WHERE chunk_group_id IS NULL
  AND last_retrieved_at >= NOW() - ($2::int * INTERVAL '1 day')
GROUP BY personality_id`);
  });

  it('excludes chunk rows', () => {
    expect(ARCHIVE_COVERAGE_SQL).toContain('chunk_group_id IS NULL');
  });

  it('bounds the row count with the module limit param', () => {
    expect(ARCHIVE_COVERAGE_SQL).toContain('LIMIT $3::int');
  });

  it('orders most-retrieved first, with the id as a deterministic tiebreak', () => {
    expect(ARCHIVE_COVERAGE_SQL).toContain('ORDER BY retrieved_in_window DESC, personality_id');
  });
});

describe('MAX_PERSONALITIES_EVALUATED', () => {
  it('is 1000', () => {
    expect(MAX_PERSONALITIES_EVALUATED).toBe(1000);
  });
});
