-- AlterTable
-- Adds chunk linking fields for oversized memories that need to be split into multiple chunks
-- for embedding (text-embedding-3-small has 8191 token limit)
ALTER TABLE "memories" ADD COLUMN "chunk_group_id" UUID;
ALTER TABLE "memories" ADD COLUMN "chunk_index" INTEGER;
ALTER TABLE "memories" ADD COLUMN "total_chunks" INTEGER;

-- CreateIndex
-- Partial index for efficient sibling chunk retrieval (only indexes non-null values)
CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");
