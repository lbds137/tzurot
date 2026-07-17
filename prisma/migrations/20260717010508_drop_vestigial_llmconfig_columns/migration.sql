/*
  Warnings:

  - You are about to drop the column `max_age` on the `llm_configs` table. All the data in the column will be lost.
  - You are about to drop the column `max_images` on the `llm_configs` table. All the data in the column will be lost.
  - You are about to drop the column `max_messages` on the `llm_configs` table. All the data in the column will be lost.
  - You are about to drop the column `memory_limit` on the `llm_configs` table. All the data in the column will be lost.
  - You are about to drop the column `memory_score_threshold` on the `llm_configs` table. All the data in the column will be lost.

*/
-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "llm_configs" DROP COLUMN "max_age",
DROP COLUMN "max_images",
DROP COLUMN "max_messages",
DROP COLUMN "memory_limit",
DROP COLUMN "memory_score_threshold";
