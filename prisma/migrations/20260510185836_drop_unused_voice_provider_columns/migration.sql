/*
  Warnings:

  - You are about to drop the column `stt_provider_id` on the `user_personality_configs` table. All the data in the column will be lost.
  - You are about to drop the column `default_provider` on the `users` table. All the data in the column will be lost.

*/
-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "user_personality_configs" DROP COLUMN "stt_provider_id";

-- AlterTable
ALTER TABLE "users" DROP COLUMN "default_provider";
