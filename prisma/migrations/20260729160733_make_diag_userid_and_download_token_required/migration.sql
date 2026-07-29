/*
  Warnings:

  - Made the column `download_token` on table `export_jobs` required. This step will fail if there are existing NULL values in that column.
  - Made the column `user_id` on table `llm_diagnostic_logs` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "export_jobs" ALTER COLUMN "download_token" SET NOT NULL;

-- AlterTable
ALTER TABLE "llm_diagnostic_logs" ALTER COLUMN "user_id" SET NOT NULL;
