/*
  Add updated_at timestamp to tables for proper sync tracking.
  For existing rows, set updated_at = created_at since they've never been modified.
*/

-- Add updated_at column as nullable first
ALTER TABLE "activated_channels" ADD COLUMN "updated_at" TIMESTAMP(3);
ALTER TABLE "personality_owners" ADD COLUMN "updated_at" TIMESTAMP(3);

-- Set updated_at to created_at for existing rows
UPDATE "activated_channels" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;
UPDATE "personality_owners" SET "updated_at" = "created_at" WHERE "updated_at" IS NULL;

-- Now make it NOT NULL
ALTER TABLE "activated_channels" ALTER COLUMN "updated_at" SET NOT NULL;
ALTER TABLE "personality_owners" ALTER COLUMN "updated_at" SET NOT NULL;
