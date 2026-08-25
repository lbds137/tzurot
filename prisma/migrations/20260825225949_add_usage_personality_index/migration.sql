-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- CreateIndex
CREATE INDEX "usage_logs_personality_id_idx" ON "usage_logs"("personality_id");
