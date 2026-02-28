-- DropIndex
DROP INDEX "conversation_history_persona_id_idx";

-- DropIndex
-- REMOVED: DROP INDEX "llm_configs_free_default_unique";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_is_locked";

-- DropIndex
-- REMOVED: DROP INDEX "memories_chunk_group_id_idx";

-- CreateIndex
CREATE INDEX "conversation_history_persona_id_personality_id_created_at_idx" ON "conversation_history"("persona_id", "personality_id", "created_at" DESC);

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");
