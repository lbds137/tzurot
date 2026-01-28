# Prisma + pgvector Operations Reference

**Last Updated**: 2025-11-17

Quick reference for working with Prisma migrations in a pgvector database.

## Standard Workflow

### 1. Make Schema Changes

Edit `prisma/schema.prisma`:

```prisma
model Memory {
  // ... existing fields

  @@index([userId, createdAt]) // ← New index
}
```

### 2. Create and Apply Migration

```bash
npx prisma migrate dev --name add_memory_user_index
```

Prisma will:

- Generate the migration SQL automatically
- Create the migration file in `prisma/migrations/`
- Apply it to your development database
- Update `_prisma_migrations` table

### 3. Deploy to Production

```bash
# Via Railway CLI
railway run npx prisma migrate deploy

# Or with environment variable
DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate deploy
```

**Note**: Railway automatically runs `npx prisma migrate deploy` during deployments via Dockerfile.

---

## Helpful Commands

### Check Migration Status

```bash
# Dev database
npx prisma migrate status

# Production database
DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate status
```

Expected output:

```
Database schema is up to date!
```

### Verify Migrations in Database

```bash
# Via Railway CLI
railway run psql -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"

# Or with direct connection
psql $DATABASE_URL -c "SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY finished_at DESC LIMIT 5;"
```

### Generate Migration SQL Manually

For complex schema changes, generate SQL without applying:

```bash
npx prisma migrate dev --create-only --name your_migration_name
```

Then edit `prisma/migrations/TIMESTAMP_your_migration_name/migration.sql` before applying.

### Execute Raw SQL

```bash
# Dev database
npx prisma db execute --file migration.sql --schema prisma/schema.prisma

# Production database
DATABASE_URL="$PROD_DATABASE_URL" npx prisma db execute --file migration.sql --schema prisma/schema.prisma
```

---

## Troubleshooting

### Issue: "Migration already applied"

**Cause**: Migration SQL was run directly on database before running `prisma migrate deploy`

**Fix**: Mark the migration as applied

```bash
npx prisma migrate resolve --applied "MIGRATION_NAME"

# For production
DATABASE_URL="$PROD_DATABASE_URL" npx prisma migrate resolve --applied "MIGRATION_NAME"
```

### Issue: "Drift detected" or "Migration modified after applied"

**Cause**: Changed migration file after it was applied to database

**Fix**: Create a new migration to correct the issue (don't modify applied migrations)

```bash
npx prisma migrate dev --name fix_previous_migration
```

If you must mark the modified migration as applied:

```bash
npx prisma migrate resolve --applied "MIGRATION_NAME"
```

### Issue: "No space left on device" (Index Creation)

**Cause**: Index creation requires more memory than Railway's `maintenance_work_mem` allows

**Fix**: Reduce index parameters

- **HNSW**: Reduce `m` and `ef_construction` values
- **IVFFlat**: Reduce `lists` parameter (e.g., from 100 to 50)

Example:

```sql
-- Instead of lists=100 (needs 65 MB)
CREATE INDEX idx_memories_embedding ON memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);  -- Needs ~33 MB
```

---

## Vector Index Best Practices

### IVFFlat Index Parameters

**lists parameter** controls accuracy vs. speed trade-off:

- **More lists** (100-200): Better accuracy, slower queries, more memory to build
- **Fewer lists** (25-50): Slightly worse accuracy, faster queries, less memory to build

**Railway constraints**: `maintenance_work_mem = 64 MB`

- lists=100 requires ~65 MB (won't work)
- lists=50 requires ~33 MB (works fine)

### Creating Vector Indexes

Always use `IF NOT EXISTS` for idempotency:

```sql
CREATE INDEX IF NOT EXISTS idx_memories_embedding ON memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);
```

For production databases, consider using `CONCURRENTLY` (requires psql, not Prisma):

```sql
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_memories_embedding ON memories
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 50);
```

**Note**: `CONCURRENTLY` cannot run inside a transaction block, so it won't work with `npx prisma db execute`.

---

## Best Practices

### ✅ DO

- **Use descriptive migration names**: `add_memory_user_index` not `update_schema`
- **Test in development first**: Apply to dev database before production
- **Commit migrations with code**: Keep schema changes atomic with code changes
- **Use `IF NOT EXISTS`**: Makes migrations idempotent and safer
- **Create migration files**: Even if you run SQL manually, create the migration file

### ❌ DON'T

- **Don't delete applied migrations**: This breaks migration history permanently
- **Don't modify applied migrations**: Create a new migration to fix issues instead
- **Don't commit `DATABASE_URL`**: Use environment variables or placeholders
- **Don't skip migration tracking**: Always mark manually-applied migrations as applied

---

## Railway Deployment

Migrations run automatically during Railway deployment via Dockerfile:

```dockerfile
# In services/*/Dockerfile
RUN npx prisma generate
RUN npx prisma migrate deploy  # ← Runs pending migrations
```

**Manual deployment** (if needed):

```bash
railway run --service SERVICE_NAME npx prisma migrate deploy
```

---

## References

- [Prisma Migrate Documentation](https://www.prisma.io/docs/concepts/components/prisma-migrate)
- [Prisma Production Troubleshooting](https://www.prisma.io/docs/guides/migrate/production-troubleshooting)
- [pgvector Extension](https://github.com/pgvector/pgvector)
- [Railway Operations Guide](../deployment/RAILWAY_OPERATIONS.md)
