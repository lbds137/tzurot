-- AlterTable: Add response_message_ids column to llm_diagnostic_logs
-- This allows looking up diagnostic logs by the AI response message ID
-- (not just the trigger message ID)
ALTER TABLE "llm_diagnostic_logs" ADD COLUMN "response_message_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex: GIN index for efficient array containment queries
CREATE INDEX "llm_diagnostic_logs_response_message_ids_idx" ON "llm_diagnostic_logs" USING GIN ("response_message_ids");
