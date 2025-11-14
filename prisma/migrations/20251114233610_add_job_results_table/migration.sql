-- CreateTable
CREATE TABLE "job_results" (
    "job_id" VARCHAR(255) NOT NULL,
    "request_id" VARCHAR(255) NOT NULL,
    "result" JSONB NOT NULL,
    "status" VARCHAR(50) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),

    CONSTRAINT "job_results_pkey" PRIMARY KEY ("job_id")
);

-- CreateIndex
CREATE INDEX "job_results_status_completed_at_idx" ON "job_results"("status", "completed_at");
