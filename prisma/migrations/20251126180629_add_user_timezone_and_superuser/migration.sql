-- AlterTable
-- Adds timezone and superuser flag for BYOK support (Sprint 2)
ALTER TABLE "users" ADD COLUMN     "is_superuser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timezone" VARCHAR(50) NOT NULL DEFAULT 'UTC';

-- NOTE: Prisma incorrectly detected idx_memories_embedding as drift because it's
-- a manually-managed HNSW index for pgvector. We intentionally do NOT drop it.
