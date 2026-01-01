-- Personality Extended Context: Boolean → Tri-State (Boolean?)
-- See docs/standards/TRI_STATE_PATTERN.md
--
-- Migration mapping:
-- - true  → NULL (AUTO: follow channel/global hierarchy)
-- - false → false (OFF: force disable)
-- No existing data maps to true (ON) - this is a new capability

-- Step 1: Make the column nullable and remove default
ALTER TABLE "personalities" ALTER COLUMN "supports_extended_context" DROP NOT NULL;
ALTER TABLE "personalities" ALTER COLUMN "supports_extended_context" DROP DEFAULT;

-- Step 2: Transform data (true → NULL means "follow hierarchy")
UPDATE "personalities" SET "supports_extended_context" = NULL WHERE "supports_extended_context" = true;

-- Step 3: Rename the column to match new naming convention
ALTER TABLE "personalities" RENAME COLUMN "supports_extended_context" TO "extended_context";
