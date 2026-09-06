-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- CreateIndex
CREATE INDEX "memory_facts_source_memory_ids_idx" ON "memory_facts" USING GIN ("source_memory_ids");
