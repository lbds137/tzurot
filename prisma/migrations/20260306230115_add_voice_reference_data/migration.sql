-- DropIndex
-- REMOVED: DROP INDEX "llm_configs_free_default_unique";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- AlterTable
ALTER TABLE "personalities" ADD COLUMN     "voice_reference_data" BYTEA,
ADD COLUMN     "voice_reference_type" VARCHAR(50);
