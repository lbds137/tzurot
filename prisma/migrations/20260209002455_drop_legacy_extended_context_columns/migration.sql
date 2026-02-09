-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "admin_settings" DROP COLUMN "extended_context_default",
DROP COLUMN "extended_context_max_age",
DROP COLUMN "extended_context_max_images",
DROP COLUMN "extended_context_max_messages";

-- AlterTable
ALTER TABLE "channel_settings" DROP COLUMN "extended_context",
DROP COLUMN "extended_context_max_age",
DROP COLUMN "extended_context_max_images",
DROP COLUMN "extended_context_max_messages";

-- AlterTable
ALTER TABLE "personalities" DROP COLUMN "extended_context",
DROP COLUMN "extended_context_max_age",
DROP COLUMN "extended_context_max_images",
DROP COLUMN "extended_context_max_messages";

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");
