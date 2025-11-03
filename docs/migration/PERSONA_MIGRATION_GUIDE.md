# Persona Migration Guide

## Overview

This guide explains how to safely migrate the `conversation_history` table from `user_id` to `persona_id` based segmentation.

**Why This Migration?**

- Fixes bug where users with multiple personas had shared conversation history
- Aligns STM (PostgreSQL) with LTM (Qdrant) segmentation strategy
- Both now segment by `persona_id` instead of mixed `user_id`/`persona_id`

**Critical**: This migration MUST be run in three steps in the correct order to avoid data loss.

---

## Migration Steps

There are **two approaches** to run this migration:

### ✅ Approach 1: All-in-One SQL Script (Recommended)

This is the safest and simplest approach for production.

#### Step 1: Run the SQL script

```bash
# Option A: Via Railway CLI
railway run --environment production psql < scripts/migrate-persona-all-in-one.sql

# Option B: Direct connection
PGPASSWORD=<password> psql -h <host> -p <port> -U postgres -d railway \
  < scripts/migrate-persona-all-in-one.sql
```

The script will:

1. Add `persona_id` column (nullable)
2. Populate `persona_id` from `user_id`
3. Make `persona_id` NOT NULL
4. Drop `user_id` column
5. Print summary of migrated rows

#### Step 2: Mark Prisma migrations as applied

After running the SQL script, tell Prisma the migrations are done:

```bash
# Mark both migrations as applied
railway run --environment production \
  npx prisma migrate resolve --applied 20251026163739_add_persona_id_to_conversation_history

railway run --environment production \
  npx prisma migrate resolve --applied 20251026164500_finalize_persona_id_migration
```

#### Step 3: Verify

```bash
# Check migration status
railway run --environment production npx prisma migrate status

# Should show both migrations as applied ✅
```

---

### ⚙️ Approach 2: Individual Steps (Advanced)

Use this if you want more control or need to debug issues.

#### Step 1: Run Migration 1 (Add nullable persona_id)

```bash
# Connect to database
railway run --environment production psql
```

Run this SQL:

```sql
ALTER TABLE "conversation_history" ADD COLUMN "persona_id" UUID;
CREATE INDEX "conversation_history_persona_id_idx" ON "conversation_history"("persona_id");
ALTER TABLE "conversation_history" ADD CONSTRAINT "conversation_history_persona_id_fkey"
  FOREIGN KEY ("persona_id") REFERENCES "personas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Mark migration as applied:

```bash
railway run --environment production \
  npx prisma migrate resolve --applied 20251026163739_add_persona_id_to_conversation_history
```

#### Step 2: Run Data Migration Script

```bash
railway run --environment production \
  npx tsx scripts/migrate-conversation-history-to-persona-id.ts
```

**Expected output**:

```
🔄 Starting conversation_history migration...
📊 Found 3,371 conversation_history rows
✅ Migration complete!
   Total rows processed: 3,371
   Successfully migrated: 3,371
   Errors: 0
```

#### Step 3: Run Migration 2 (Finalize)

```bash
# This will only run migration 2 since migration 1 is marked as applied
railway run --environment production npx prisma migrate deploy
```

Or run SQL manually:

```sql
ALTER TABLE "conversation_history" ALTER COLUMN "persona_id" SET NOT NULL;
ALTER TABLE "conversation_history" DROP CONSTRAINT "conversation_history_user_id_fkey";
DROP INDEX "conversation_history_user_id_idx";
ALTER TABLE "conversation_history" DROP COLUMN "user_id";
```

---

## Verification

After migration, verify everything worked:

```bash
# Check schema
railway run --environment production psql -c "\d conversation_history"

# Should show:
# - persona_id UUID NOT NULL
# - NO user_id column
# - Foreign key to personas table

# Check data
railway run --environment production psql -c "
  SELECT
    COUNT(*) as total_rows,
    COUNT(DISTINCT persona_id) as unique_personas,
    COUNT(*) FILTER (WHERE persona_id IS NULL) as null_persona_ids
  FROM conversation_history;
"

# Should show:
# - total_rows: (your count)
# - unique_personas: (number of unique personas)
# - null_persona_ids: 0 ✅
```

---

## Rollback Plan

If something goes wrong, you can rollback:

### Before Migration 2 (persona_id is nullable)

```sql
-- Remove persona_id
ALTER TABLE conversation_history DROP CONSTRAINT conversation_history_persona_id_fkey;
DROP INDEX conversation_history_persona_id_idx;
ALTER TABLE conversation_history DROP COLUMN persona_id;

-- Mark migration as rolled back
npx prisma migrate resolve --rolled-back 20251026163739_add_persona_id_to_conversation_history
```

### After Migration 2 (user_id is dropped)

⚠️ **Cannot rollback** - `user_id` data is lost!

This is why we recommend:

1. Test in development first
2. Backup production database before migration
3. Run migration during low-traffic period

---

## Development Environment

**Status**: ✅ Already migrated

Development database was migrated during implementation. No action needed.

To verify:

```bash
railway run npx prisma migrate status

# Should show both migrations as applied
```

---

## Production Checklist

Before running migration in production:

- [ ] Backup production database
- [ ] Test migration in staging/development
- [ ] Schedule migration during low-traffic period
- [ ] Notify team of maintenance window (if applicable)
- [ ] Have rollback plan ready (only works before migration 2)
- [ ] Verify all services are using latest code that expects `persona_id`

After migration:

- [ ] Verify schema changes (`\d conversation_history`)
- [ ] Verify data integrity (all rows have `persona_id`, none are NULL)
- [ ] Test multi-user conversations
- [ ] Check logs for errors
- [ ] Monitor for 24 hours

---

## Troubleshooting

### "Some rows still have NULL persona_id"

This means some users don't have default personas. To fix:

```sql
-- Find users without default personas
SELECT u.id, u.username
FROM users u
LEFT JOIN user_default_personas udp ON u.id = udp.user_id
WHERE udp.persona_id IS NULL;

-- Create default personas for them (requires application code)
-- Or delete orphaned conversation_history rows (data loss!)
```

### "Foreign key violation"

This means `persona_id` references don't exist in `personas` table. To fix:

```sql
-- Find invalid persona_ids
SELECT DISTINCT persona_id
FROM conversation_history
WHERE persona_id NOT IN (SELECT id FROM personas);

-- Delete orphaned rows (or create missing personas)
```

### "Migration already applied"

This is safe to ignore. The all-in-one script checks for existing columns before running.

---

## Questions?

- Check commit `9af17bd` for implementation details
- See `scripts/migrate-conversation-history-to-persona-id.ts` for data migration logic
- See `prisma/migrations/20251026*` for schema changes
