-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "denylisted_entities" ADD COLUMN     "mode" VARCHAR(10) NOT NULL DEFAULT 'BLOCK';

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");
