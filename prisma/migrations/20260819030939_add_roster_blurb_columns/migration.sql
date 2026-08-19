-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "personalities" ADD COLUMN     "roster_blurb" TEXT,
ADD COLUMN     "roster_blurb_source_hash" VARCHAR(64);
