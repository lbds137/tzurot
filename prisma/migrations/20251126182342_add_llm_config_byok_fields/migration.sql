-- AlterTable (Step A: Add new columns, legacy columns preserved for data migration)
-- NOTE: Prisma incorrectly detects idx_memories_embedding as drift (manually-managed HNSW index)
ALTER TABLE "llm_configs" ADD COLUMN     "advanced_parameters" JSONB,
ADD COLUMN     "max_referenced_messages" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "provider" VARCHAR(20) NOT NULL DEFAULT 'openrouter';
