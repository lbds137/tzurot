-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memory_facts_embedding";

-- CreateTable
CREATE TABLE "command_events" (
    "id" UUID NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" VARCHAR(20) NOT NULL,
    "guild_id" VARCHAR(20),
    "channel_kind" VARCHAR(10) NOT NULL,
    "command" VARCHAR(100) NOT NULL,
    "character_id" UUID,
    "outcome" VARCHAR(20) NOT NULL,
    "error_code" VARCHAR(100),
    "latency_ms" INTEGER NOT NULL,
    "context" JSONB,

    CONSTRAINT "command_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "command_events_occurred_at_idx" ON "command_events"("occurred_at");

-- CreateIndex
CREATE INDEX "command_events_user_id_idx" ON "command_events"("user_id");
