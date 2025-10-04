-- AlterTable
ALTER TABLE "llm_configs" ADD COLUMN     "memory_limit" INTEGER,
ADD COLUMN     "memory_score_threshold" DECIMAL(3,2);
