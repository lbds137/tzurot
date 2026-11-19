-- AlterTable
ALTER TABLE "usage_logs" ADD COLUMN     "cache_read_tokens" INTEGER,
ADD COLUMN     "cache_write_tokens" INTEGER;
