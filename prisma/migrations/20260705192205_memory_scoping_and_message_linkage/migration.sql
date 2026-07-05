-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "canon_group_id" UUID,
ADD COLUMN     "is_fiction" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pool" VARCHAR(20) NOT NULL DEFAULT 'private';

-- CreateIndex
CREATE INDEX "memories_message_ids_idx" ON "memories" USING GIN ("message_ids");

-- CreateIndex
CREATE INDEX "memories_pool_idx" ON "memories"("pool");
