-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "user_personality_configs" ADD COLUMN     "stt_provider_id" VARCHAR(20);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "default_provider" VARCHAR(20),
ADD COLUMN     "default_stt_provider_id" VARCHAR(20);
