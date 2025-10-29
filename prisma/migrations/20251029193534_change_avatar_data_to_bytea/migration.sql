-- AlterTable
-- Change avatar_data from TEXT to BYTEA for more efficient binary storage
-- This migration will drop existing avatar data (will be re-imported)
ALTER TABLE "personalities" DROP COLUMN "avatar_data";
ALTER TABLE "personalities" ADD COLUMN "avatar_data" BYTEA;
