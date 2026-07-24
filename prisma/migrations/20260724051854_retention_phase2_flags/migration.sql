-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- AlterTable
ALTER TABLE "personalities" ADD COLUMN     "original_owner_discord_id" VARCHAR(20);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "discord_account_gone_at" TIMESTAMP(3),
ADD COLUMN     "retention_exempt" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "retention_purge_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "target_discord_id" VARCHAR(20) NOT NULL,
    "purged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_context" TEXT,
    "deletion_counts" JSONB NOT NULL,
    "db_outcome" VARCHAR(16) NOT NULL,
    "off_db_reconciled" VARCHAR(16) NOT NULL DEFAULT 'pending',

    CONSTRAINT "retention_purge_log_pkey" PRIMARY KEY ("id")
);
