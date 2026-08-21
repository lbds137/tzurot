-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "personalities" ADD COLUMN     "roster_blurb_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "roster_blurb_failed_source_hash" VARCHAR(64),
ADD COLUMN     "roster_blurb_last_failed_at" TIMESTAMP(3);
