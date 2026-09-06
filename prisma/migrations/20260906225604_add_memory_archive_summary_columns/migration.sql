-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "assistant_summary" TEXT,
ADD COLUMN     "source_content_hash" VARCHAR(64),
ADD COLUMN     "summary_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "summary_completed_at" TIMESTAMP(3),
ADD COLUMN     "summary_last_error" VARCHAR(40),
ADD COLUMN     "summary_model" VARCHAR(255),
ADD COLUMN     "summary_prompt_version" INTEGER,
ADD COLUMN     "summary_requested_at" TIMESTAMP(3),
ADD COLUMN     "summary_status" VARCHAR(10);
