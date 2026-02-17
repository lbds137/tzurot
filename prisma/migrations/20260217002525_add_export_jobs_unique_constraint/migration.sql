-- DropIndex
-- REMOVED: DROP INDEX "llm_configs_free_default_unique";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_is_locked";

-- DropIndex
-- REMOVED: DROP INDEX "memories_chunk_group_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_user_id_source_slug_source_service_key" ON "export_jobs"("user_id", "source_slug", "source_service");

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");
