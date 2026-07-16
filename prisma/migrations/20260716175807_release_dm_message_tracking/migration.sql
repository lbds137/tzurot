-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "release_delivery_log" ADD COLUMN     "message_deleted_at" TIMESTAMP(3),
ADD COLUMN     "sent_message_id" VARCHAR(30);
