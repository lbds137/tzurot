-- AlterTable
-- Change personality_tone and personality_age from VARCHAR to TEXT to support longer descriptions
ALTER TABLE "personalities" ALTER COLUMN "personality_tone" TYPE TEXT;
ALTER TABLE "personalities" ALTER COLUMN "personality_age" TYPE TEXT;
