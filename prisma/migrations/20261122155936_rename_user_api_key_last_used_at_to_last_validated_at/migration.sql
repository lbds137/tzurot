-- Rename user_api_keys.last_used_at -> last_validated_at, preserving data.
-- Prisma generated DROP COLUMN + ADD COLUMN for the @map change, which would
-- erase every stored timestamp; RENAME COLUMN keeps the values.
-- Destructive for still-running old code (it reads last_used_at): prod applies
-- this inside a maintenance window (release:premigrate --allow-destructive).

-- AlterTable
ALTER TABLE "user_api_keys" RENAME COLUMN "last_used_at" TO "last_validated_at";
