-- CreateIndex: Add missing guild_id index for LlmDiagnosticLog
-- This was missed in the original migration but is needed for query performance
CREATE INDEX "llm_diagnostic_logs_guild_id_idx" ON "llm_diagnostic_logs"("guild_id");
