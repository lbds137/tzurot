-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dm_undeliverable_since" TIMESTAMP(3),
ADD COLUMN     "last_active_at" TIMESTAMP(3);
