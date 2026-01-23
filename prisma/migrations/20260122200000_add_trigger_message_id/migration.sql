-- AlterTable: Add trigger_message_id for Discord message lookup
-- This allows /admin debug to accept a Discord message ID instead of requiring the internal request ID
ALTER TABLE "llm_diagnostic_logs" ADD COLUMN "trigger_message_id" VARCHAR(20);

-- CreateIndex
CREATE INDEX "llm_diagnostic_logs_trigger_message_id_idx" ON "llm_diagnostic_logs"("trigger_message_id");
