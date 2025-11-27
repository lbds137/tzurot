-- CreateIndex
CREATE INDEX "usage_logs_user_id_provider_idx" ON "usage_logs"("user_id", "provider");
