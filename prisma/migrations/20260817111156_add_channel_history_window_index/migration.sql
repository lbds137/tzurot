-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- CreateIndex
CREATE INDEX "conversation_history_channel_id_created_at_id_idx" ON "conversation_history"("channel_id", "created_at" DESC, "id" DESC);
