-- CreateTable: Tombstones for hard-deleted conversation history
--
-- This table prevents db-sync from restoring hard-deleted messages.
-- When a message is hard-deleted, a tombstone record is created with the same ID.
-- The sync process checks for tombstones and skips/deletes matching messages.
--
-- IMPORTANT: FK constraints are INTENTIONALLY OMITTED because:
-- 1. Tombstones must outlive their referenced personalities/personas
-- 2. If a personality is deleted, tombstones should remain to prevent resurrection
-- 3. The cleanupOldTombstones() function handles cleanup after a retention period
-- 4. Orphaned tombstones are harmless (small records, cleaned up periodically)
--
CREATE TABLE "conversation_history_tombstones" (
    "id" UUID NOT NULL,
    "channel_id" VARCHAR(20) NOT NULL,
    "personality_id" UUID NOT NULL,
    "persona_id" UUID NOT NULL,
    "deleted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_history_tombstones_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_history_tombstones_channel_id_personality_id_p_idx" ON "conversation_history_tombstones"("channel_id", "personality_id", "persona_id");

-- CreateIndex
CREATE INDEX "conversation_history_tombstones_deleted_at_idx" ON "conversation_history_tombstones"("deleted_at");
