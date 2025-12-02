-- Add defaultPersonaId column to users table (consistent with defaultLlmConfigId pattern)
-- This replaces the UserDefaultPersona join table with a direct FK

-- Step 1: Add the new column
ALTER TABLE "users" ADD COLUMN "default_persona_id" UUID;

-- Step 2: Migrate data from the join table to the new column
UPDATE "users" u
SET "default_persona_id" = udp."persona_id"
FROM "user_default_personas" udp
WHERE u."id" = udp."user_id";

-- Step 3: Add the foreign key constraint
ALTER TABLE "users" ADD CONSTRAINT "users_default_persona_id_fkey"
    FOREIGN KEY ("default_persona_id") REFERENCES "personas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Step 4: Create index for the new column
CREATE INDEX "users_default_persona_id_idx" ON "users"("default_persona_id");

-- Step 5: Drop the now-redundant join table
DROP TABLE "user_default_personas";
