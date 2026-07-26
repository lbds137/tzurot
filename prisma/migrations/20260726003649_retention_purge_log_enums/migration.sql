/*
  Warnings:

  - The `off_db_reconciled` column on the `retention_purge_log` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Changed the type of `db_outcome` on the `retention_purge_log` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "db_outcome" AS ENUM ('success', 'failed');

-- CreateEnum
CREATE TYPE "off_db_reconciled" AS ENUM ('pending', 'done', 'failed');

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "retention_purge_log" ADD COLUMN     "off_db_pending" JSONB,
DROP COLUMN "db_outcome",
ADD COLUMN     "db_outcome" "db_outcome" NOT NULL,
DROP COLUMN "off_db_reconciled",
ADD COLUMN     "off_db_reconciled" "off_db_reconciled" NOT NULL DEFAULT 'pending';
