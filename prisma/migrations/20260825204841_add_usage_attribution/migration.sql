-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "usage_logs" ADD COLUMN     "byok" BOOLEAN,
ADD COLUMN     "latency_ms" INTEGER,
ADD COLUMN     "personality_id" UUID;

-- AddForeignKey
ALTER TABLE "usage_logs" ADD CONSTRAINT "usage_logs_personality_id_fkey" FOREIGN KEY ("personality_id") REFERENCES "personalities"("id") ON DELETE SET NULL ON UPDATE CASCADE;
