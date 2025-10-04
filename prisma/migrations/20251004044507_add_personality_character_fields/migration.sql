/*
  Warnings:

  - Added the required column `character_info` to the `personalities` table without a default value. This is not possible if the table is not empty.
  - Added the required column `personality_traits` to the `personalities` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable - Add columns with temporary defaults for existing rows
ALTER TABLE "personalities"
  ADD COLUMN "character_info" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "personality_traits" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "conversational_examples" TEXT,
  ADD COLUMN "conversational_goals" TEXT,
  ADD COLUMN "custom_fields" JSONB,
  ADD COLUMN "personality_age" VARCHAR(100),
  ADD COLUMN "personality_dislikes" TEXT,
  ADD COLUMN "personality_likes" TEXT,
  ADD COLUMN "personality_tone" VARCHAR(500);

-- Remove defaults after adding columns (so future rows must provide values)
ALTER TABLE "personalities"
  ALTER COLUMN "character_info" DROP DEFAULT,
  ALTER COLUMN "personality_traits" DROP DEFAULT;
