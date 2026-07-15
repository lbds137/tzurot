-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- CreateIndex
CREATE INDEX "user_feedback_user_id_content_hash_idx" ON "user_feedback"("user_id", "content_hash");
