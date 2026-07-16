-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "notify_opted_in_at" TIMESTAMP(3),
ALTER COLUMN "notify_level" SET DEFAULT 'major';
