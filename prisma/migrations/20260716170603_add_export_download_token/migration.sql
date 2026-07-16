-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "export_jobs" ADD COLUMN     "download_token" VARCHAR(64);

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_download_token_key" ON "export_jobs"("download_token");
