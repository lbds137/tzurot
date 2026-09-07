-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "last_retrieved_at" TIMESTAMP(3),
ADD COLUMN     "retrieval_count" INTEGER NOT NULL DEFAULT 0;
