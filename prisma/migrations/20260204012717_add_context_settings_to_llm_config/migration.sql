-- DropIndex
DROP INDEX "image_description_cache_attachment_id_idx";


-- AlterTable
ALTER TABLE "llm_configs" ADD COLUMN     "max_age" INTEGER,
ADD COLUMN     "max_images" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "max_messages" INTEGER NOT NULL DEFAULT 50,
ALTER COLUMN "max_referenced_messages" SET DEFAULT 100;

-- AlterTable
ALTER TABLE "llm_diagnostic_logs" ALTER COLUMN "id" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "memories_is_locked_idx" ON "memories"("is_locked");

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");

-- RenameIndex
ALTER INDEX "idx_memories_visibility" RENAME TO "memories_visibility_idx";
