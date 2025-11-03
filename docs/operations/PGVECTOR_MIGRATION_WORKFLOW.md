# pgvector Migration Workflow

**Last Updated**: 2025-10-31
**Status**: ✅ RESOLVED - Normal Prisma workflow now works!

## The Problem (Solved!)

Prisma Migrate's default workflow (`prisma migrate dev`) originally **did not work** with pgvector databases because:

1. `prisma migrate dev` requires a shadow database to validate migrations
2. Shadow databases are temporary and don't have the pgvector extension installed
3. This caused "type vector does not exist" errors and drift detection issues

## The Solution: Install pgvector in template1

✅ **WE FIXED THIS!** By installing the pgvector extension in PostgreSQL's `template1` database, all new databases (including Prisma's shadow database) automatically have pgvector enabled.

### One-Time Setup (Already Done)

```sql
-- Connect to template1 database
psql $DATABASE_URL -d template1 -c "CREATE EXTENSION IF NOT EXISTS vector;"
```

Now the **normal Prisma workflow works perfectly**:

```bash
# Make schema changes
vim prisma/schema.prisma

# Create and apply migration (works with shadow database!)
npx prisma migrate dev --name your_migration_name
```

---

## Standard Workflow

### 1. Make Schema Changes

Edit `prisma/schema.prisma`:

```prisma
model PendingMemory {
  // ... existing fields

  @@index([attempts, createdAt]) // ← New index
}
```

### 2. Create and Apply Migration

```bash
npx prisma migrate dev --name add_pending_memory_attempts_index
```

That's it! Prisma will:

- Generate the migration SQL automatically
- Create the migration file in `prisma/migrations/`
- Apply it to your development database
- Update `_prisma_migrations` table

### 3. Deploy to Production

Migrations run automatically on Railway during deployment via Dockerfile, or manually:

```bash
railway run npx prisma migrate deploy
```

---

## Helpful Commands

### Generate Migration SQL Automatically

For complex schema changes, use Prisma to generate the SQL:

```bash
# Compare current database to new schema
npx prisma migrate diff \
  --from-schema-datamodel prisma/schema.prisma \
  --to-schema-datamodel prisma/schema.prisma \
  --script > migration.sql
```

### Check Migration Status

```bash
npx prisma migrate status
```

Expected output:

```
Database schema is up to date!
```

### Verify Migrations in Database

```bash
psql $DATABASE_URL -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"
```

---

## Common Issues & Fixes

### Issue: "Migration already applied"

**Cause**: Migration SQL was run directly on database before running `prisma migrate deploy`

**Fix**:

```bash
npx prisma migrate resolve --applied <migration_name>
```

### Issue: "Drift detected" or "Migration modified after applied"

**Cause**: Changed migration file after it was applied to database

**Fix**:

```bash
# Remove migration from database
psql $DATABASE_URL -c "DELETE FROM _prisma_migrations WHERE migration_name = 'MIGRATION_NAME';"

# Re-apply with updated checksum
npx prisma migrate resolve --applied <migration_name>
```

### Issue: "type vector does not exist"

**Cause**: Trying to use `prisma migrate dev` instead of manual workflow

**Fix**: Use the manual migration workflow above. `prisma migrate dev` **cannot** be used with pgvector.

---

## Initial Setup (Baseline Migration)

When setting up a new pgvector database, create a baseline migration:

### 1. Generate Full Schema SQL

```bash
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > /tmp/baseline.sql
```

### 2. Add pgvector Extension

Create `prisma/migrations/20250131000000_init/migration.sql`:

```sql
-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- (paste generated schema SQL here)
```

### 3. Mark as Applied

```bash
npx prisma migrate resolve --applied 20250131000000_init
```

---

## Railway Deployment

Migrations run automatically on Railway during deployment via the Dockerfile:

```dockerfile
# In services/*/Dockerfile
RUN npx prisma generate
RUN npx prisma migrate deploy  # ← Runs migrations
```

**No manual intervention needed** - just push to GitHub and Railway deploys.

---

## Best Practices

### ✅ DO

- **Always create migration files** - Even if you run SQL manually first
- **Use descriptive names** - `add_pending_memory_attempts_index` not `update_schema`
- **Test in development first** - Apply to dev database before production
- **Commit migrations with code** - Keep schema changes atomic with code changes
- **Use `IF NOT EXISTS`** - Makes migrations idempotent and safer

### ❌ DON'T

- **Don't use `prisma migrate dev`** - It doesn't work with pgvector
- **Don't delete applied migrations** - This breaks migration history permanently
- **Don't modify applied migrations** - Create a new migration instead
- **Don't skip migration files** - Always create the file even if SQL was run manually
- **Don't commit `DATABASE_URL`** - Migrations should work with any database URL

---

## Why We Need This

**Q**: Why can't we just use `prisma db push`?

**A**: `prisma db push` skips migration history entirely. This means:

- No rollback capability
- No audit trail of schema changes
- Harder to sync dev/production
- Can't track what changed when

**Q**: Why not fix the shadow database issue?

**A**: The shadow database is a Prisma-managed temporary database. We can't install custom extensions like pgvector on it. This is a known Prisma limitation with custom PostgreSQL extensions.

---

## References

- [Prisma Migrate in Production](https://www.prisma.io/docs/guides/migrate/production-troubleshooting)
- [pgvector Extension](https://github.com/pgvector/pgvector)
- [Railway Migrations Guide](/docs/deployment/DEPLOYMENT.md)
