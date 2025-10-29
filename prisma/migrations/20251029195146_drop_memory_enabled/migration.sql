-- AlterTable
-- Drop memory_enabled column as memory is now always enabled for all personalities
ALTER TABLE "personalities" DROP COLUMN "memory_enabled";
