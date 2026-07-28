-- Data-only backfill (no schema change): retire facts whose source memories
-- were deleted before the deletion cascade existed. Runtime deletions now run
-- this same predicate via propagateDeletionToFacts (any-source semantics;
-- locked and corrected-tier facts are user curation and are retained;
-- forgotten/superseded rows keep their own states). Without this backfill,
-- historical leaks would persist until the next organic memory deletion
-- triggers the self-healing sweep.
UPDATE memory_facts
SET visibility = 'deleted', updated_at = NOW()
FROM (SELECT id::text AS id_text FROM memories WHERE visibility = 'deleted') dm
WHERE memory_facts.visibility = 'normal'
  AND memory_facts.forgotten = false
  AND memory_facts.superseded_at IS NULL
  AND memory_facts.is_locked = false
  AND memory_facts.tier <> 'corrected'
  AND dm.id_text = ANY (memory_facts.source_memory_ids);
