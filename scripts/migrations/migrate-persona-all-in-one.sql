-- Tzurot v3 - Complete Persona Migration
-- This script safely migrates conversation_history from userId to personaId
-- Run this on production to avoid running migrations individually
--
-- IMPORTANT: This combines both Prisma migrations + data migration in correct order
--
-- Usage:
--   PGPASSWORD=<password> psql -h <host> -p <port> -U postgres -d railway < scripts/migrate-persona-all-in-one.sql
--
-- Or via Railway:
--   railway run --environment production psql < scripts/migrate-persona-all-in-one.sql

BEGIN;

-- ============================================
-- STEP 1: Add persona_id column (nullable)
-- (Migration: 20251026163739_add_persona_id_to_conversation_history)
-- ============================================

DO $$
BEGIN
    -- Check if persona_id column already exists
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conversation_history'
        AND column_name = 'persona_id'
    ) THEN
        -- Add nullable persona_id column
        ALTER TABLE "conversation_history" ADD COLUMN "persona_id" UUID;

        -- Add index
        CREATE INDEX "conversation_history_persona_id_idx" ON "conversation_history"("persona_id");

        -- Add foreign key
        ALTER TABLE "conversation_history" ADD CONSTRAINT "conversation_history_persona_id_fkey"
          FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;

        RAISE NOTICE 'Step 1: Added persona_id column (nullable)';
    ELSE
        RAISE NOTICE 'Step 1: persona_id column already exists, skipping';
    END IF;
END $$;

-- ============================================
-- STEP 2: Populate persona_id from user_id
-- (Data migration script logic)
-- ============================================

DO $$
DECLARE
    affected_rows INTEGER;
BEGIN
    -- Update all rows that have user_id but no persona_id
    WITH user_personas AS (
        SELECT
            u.id as user_id,
            udp.persona_id as persona_id
        FROM users u
        LEFT JOIN user_default_personas udp ON u.id = udp.user_id
    )
    UPDATE conversation_history ch
    SET persona_id = up.persona_id
    FROM user_personas up
    WHERE ch.user_id = up.user_id
      AND ch.persona_id IS NULL;

    GET DIAGNOSTICS affected_rows = ROW_COUNT;
    RAISE NOTICE 'Step 2: Populated persona_id for % rows', affected_rows;

    -- Verify all rows have persona_id
    IF EXISTS (SELECT 1 FROM conversation_history WHERE persona_id IS NULL) THEN
        RAISE EXCEPTION 'ERROR: Some conversation_history rows still have NULL persona_id!';
    END IF;

    RAISE NOTICE 'Step 2: Verification passed - all rows have persona_id';
END $$;

-- ============================================
-- STEP 3: Make persona_id NOT NULL and drop user_id
-- (Migration: 20251026164500_finalize_persona_id_migration)
-- ============================================

DO $$
BEGIN
    -- Check if user_id column still exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'conversation_history'
        AND column_name = 'user_id'
    ) THEN
        -- Make persona_id NOT NULL
        ALTER TABLE "conversation_history" ALTER COLUMN "persona_id" SET NOT NULL;

        -- Drop user_id foreign key
        ALTER TABLE "conversation_history" DROP CONSTRAINT IF EXISTS "conversation_history_user_id_fkey";

        -- Drop user_id index
        DROP INDEX IF EXISTS "conversation_history_user_id_idx";

        -- Drop user_id column
        ALTER TABLE "conversation_history" DROP COLUMN "user_id";

        RAISE NOTICE 'Step 3: Made persona_id NOT NULL and dropped user_id column';
    ELSE
        RAISE NOTICE 'Step 3: user_id column already dropped, skipping';
    END IF;
END $$;

COMMIT;

-- ============================================
-- Summary
-- ============================================
SELECT
    'Migration complete!' as status,
    COUNT(*) as total_conversation_history_rows,
    COUNT(DISTINCT persona_id) as unique_personas
FROM conversation_history;
