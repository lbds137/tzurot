-- CreateIndex
-- Composite index for per-provider usage queries with date range
-- Optimizes queries like: WHERE userId = X AND provider = Y AND createdAt >= Z
CREATE INDEX "usage_logs_user_id_provider_created_at_idx" ON "usage_logs"("user_id", "provider", "created_at");
