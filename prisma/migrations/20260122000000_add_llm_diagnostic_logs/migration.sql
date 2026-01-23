-- CreateTable
-- "Flight recorder" for LLM requests - captures full pipeline data for debugging.
-- Ephemeral: auto-deleted after 24 hours via BullMQ cleanup job.
-- Uses @default(uuid()) since this is debug data that doesn't sync between environments.
CREATE TABLE "llm_diagnostic_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "request_id" VARCHAR(255) NOT NULL,
    "personality_id" UUID,
    "user_id" VARCHAR(20),
    "guild_id" VARCHAR(20),
    "channel_id" VARCHAR(20),
    "model" VARCHAR(255) NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "llm_diagnostic_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "llm_diagnostic_logs_request_id_key" ON "llm_diagnostic_logs"("request_id");

-- CreateIndex
CREATE INDEX "llm_diagnostic_logs_created_at_idx" ON "llm_diagnostic_logs"("created_at");

-- CreateIndex
CREATE INDEX "llm_diagnostic_logs_personality_id_idx" ON "llm_diagnostic_logs"("personality_id");

-- CreateIndex
CREATE INDEX "llm_diagnostic_logs_user_id_idx" ON "llm_diagnostic_logs"("user_id");

-- CreateIndex
CREATE INDEX "llm_diagnostic_logs_channel_id_idx" ON "llm_diagnostic_logs"("channel_id");
