-- NOTE: Prisma incorrectly detects idx_memories_embedding as drift (manually-managed ivfflat index)
-- DO NOT drop it - it's essential for vector similarity search performance

-- Replace birthday DATE column with separate int fields for day/month/year
-- This allows setting birthdays without requiring a specific year (e.g., "March 15th")

-- Step 1: Add new columns
ALTER TABLE "personalities"
ADD COLUMN "birth_day" INTEGER,
ADD COLUMN "birth_month" INTEGER,
ADD COLUMN "birth_year" INTEGER;

-- Step 2: Migrate existing data (if any birthday values exist)
UPDATE "personalities"
SET
  birth_day = EXTRACT(DAY FROM birthday)::INTEGER,
  birth_month = EXTRACT(MONTH FROM birthday)::INTEGER,
  birth_year = EXTRACT(YEAR FROM birthday)::INTEGER
WHERE birthday IS NOT NULL;

-- Step 3: Drop the old column
ALTER TABLE "personalities" DROP COLUMN "birthday";
