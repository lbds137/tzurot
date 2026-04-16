/*
  Warnings:

  - Made the column `default_persona_id` on table `users` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "default_persona_id" SET NOT NULL;
