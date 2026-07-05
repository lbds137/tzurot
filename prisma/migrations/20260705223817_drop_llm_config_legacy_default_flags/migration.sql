/*
  Warnings:

  - You are about to drop the column `is_default` on the `llm_configs` table. All the data in the column will be lost.
  - You are about to drop the column `is_free_default` on the `llm_configs` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "llm_configs_is_free_default_idx";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex: the partial-unique default-flag indexes (hand-written in earlier
-- migrations; Prisma can't represent them). Explicit drops rather than relying
-- on the column-drop cascade, so tooling that harvests partial indexes from
-- migration history (PGLite schema generator) sees the retirement.
DROP INDEX IF EXISTS "llm_configs_default_unique";
DROP INDEX IF EXISTS "llm_configs_free_default_unique";

-- AlterTable
ALTER TABLE "llm_configs" DROP COLUMN "is_default",
DROP COLUMN "is_free_default";
