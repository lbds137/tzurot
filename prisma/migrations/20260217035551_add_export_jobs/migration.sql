-- DropIndex
-- REMOVED: DROP INDEX "llm_configs_free_default_unique";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_embedding";

-- DropIndex
-- REMOVED: DROP INDEX "idx_memories_is_locked";

-- DropIndex
-- REMOVED: DROP INDEX "memories_chunk_group_id_idx";

-- CreateTable
CREATE TABLE "export_jobs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "source_slug" VARCHAR(255) NOT NULL,
    "source_service" VARCHAR(50) NOT NULL,
    "status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "format" VARCHAR(20) NOT NULL DEFAULT 'json',
    "file_content" TEXT,
    "file_name" VARCHAR(255),
    "file_size_bytes" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "error_message" TEXT,
    "export_metadata" JSONB,

    CONSTRAINT "export_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "export_jobs_user_id_idx" ON "export_jobs"("user_id");

-- CreateIndex
CREATE INDEX "export_jobs_status_idx" ON "export_jobs"("status");

-- CreateIndex
CREATE INDEX "export_jobs_expires_at_idx" ON "export_jobs"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "export_jobs_user_id_source_slug_source_service_key" ON "export_jobs"("user_id", "source_slug", "source_service");

-- CreateIndex
-- REMOVED: CREATE INDEX "memories_chunk_group_id_idx" ON "memories"("chunk_group_id");

-- AddForeignKey
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
