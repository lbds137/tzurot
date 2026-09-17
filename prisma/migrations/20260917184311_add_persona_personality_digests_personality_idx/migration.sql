-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- CreateIndex
CREATE INDEX "persona_personality_digests_personality_id_idx" ON "persona_personality_digests"("personality_id");
