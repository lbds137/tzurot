-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- Partial index backing the NullVectorReembedder hourly sweep:
--   SELECT id, content FROM memories
--   WHERE embedding IS NULL AND visibility = 'normal'
--   ORDER BY created_at ASC LIMIT 50
-- The generic visibility index is non-selective ('normal' is the dominant
-- value); without this, the sweep scans all live rows every hour. The partial
-- index stays tiny (only broken rows qualify) and makes the sweep O(backlog).
CREATE INDEX "idx_memories_null_embedding" ON "memories" ("created_at")
  WHERE embedding IS NULL AND visibility = 'normal';
