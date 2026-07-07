-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "personalities" ADD COLUMN     "definition_public" BOOLEAN NOT NULL DEFAULT false;
