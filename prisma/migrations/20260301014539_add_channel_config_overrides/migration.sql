-- DropIndex
-- REMOVED: DROP INDEX "llm_configs_free_default_unique";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_is_locked";

-- DropIndex
-- REMOVED: DROP INDEX "memories_chunk_group_id_idx";

-- AlterTable
ALTER TABLE "channel_settings" ADD COLUMN     "config_overrides" JSONB;

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");
