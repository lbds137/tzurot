-- Data Migration: Move custom_fields.errorMessage → error_message column
-- This is a data-only migration (no schema changes)

-- Move errorMessage from JSONB custom_fields to dedicated column
-- Only updates rows where:
--   1. custom_fields contains an errorMessage key
--   2. error_message column is currently NULL (not already migrated)
UPDATE personalities
SET error_message = custom_fields->>'errorMessage'
WHERE custom_fields->>'errorMessage' IS NOT NULL
  AND error_message IS NULL;

-- Report how many rows were updated (for logging purposes)
-- This will show in the migration output
DO $$
DECLARE
  updated_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO updated_count
  FROM personalities
  WHERE error_message IS NOT NULL
    AND custom_fields->>'errorMessage' IS NOT NULL;

  RAISE NOTICE 'Migrated % personalities with errorMessage', updated_count;
END $$;
