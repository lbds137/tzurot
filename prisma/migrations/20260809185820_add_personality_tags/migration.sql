-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "personalities" ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
