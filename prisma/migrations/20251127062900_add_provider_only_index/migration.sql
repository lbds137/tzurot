-- CreateIndex
-- For admin queries filtering by provider across all users
CREATE INDEX "usage_logs_provider_idx" ON "usage_logs"("provider");
