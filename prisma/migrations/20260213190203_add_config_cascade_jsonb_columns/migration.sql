-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "admin_settings" ADD COLUMN     "config_defaults" JSONB;

-- AlterTable
ALTER TABLE "personalities" ADD COLUMN     "config_defaults" JSONB;

-- AlterTable
ALTER TABLE "user_personality_configs" ADD COLUMN     "config_overrides" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "config_defaults" JSONB;

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");
