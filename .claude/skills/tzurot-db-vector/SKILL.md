---
name: tzurot-db-vector
description: PostgreSQL and pgvector patterns for Tzurot v3 - Connection management, vector operations, migrations, and Railway-specific considerations. Use when working with database or memory retrieval.
lastUpdated: '2025-12-31'
---

# Tzurot v3 Database & Vector Memory

**Use this skill when:** Working with database queries, pgvector similarity search, migrations, or connection pool management.

## Quick Reference

```bash
# Migration workflow (ALWAYS use this)
npx prisma migrate dev --create-only --name descriptive_name
# Review generated SQL for DROP INDEX statements!
npx prisma migrate deploy

# Check migration status
npx prisma migrate status

# Drift detection and fix (NON-DESTRUCTIVE)
pnpm --filter @tzurot/scripts run db:check-drift
pnpm --filter @tzurot/scripts run db:fix-drift -- <migration_name>
```

## Core Principles

1. **Connection pooling** - Use Prisma singleton, Railway limit is 100 connections
2. **Typed queries** - Use Prisma, avoid raw SQL where possible
3. **Migration-first** - Schema changes via Prisma migrations
4. **Vector indexing** - Use ivfflat for fast similarity search
5. **Review migrations** - Prisma tries to DROP pgvector indexes

## Connection Management

```typescript
// ✅ GOOD - Reuse singleton from common-types
import { getPrismaClient } from '@tzurot/common-types';

class PersonalityService {
  constructor(private prisma = getPrismaClient()) {}
}

// ❌ BAD - Creates new connection every time
async getPersonality() {
  const prisma = new PrismaClient(); // Don't do this!
}
```

**Pool configuration:** `connectionLimit = 20` per service (3 services = 60, leaving headroom)

## 🚨 pgvector Index Protection (CRITICAL)

### The Problem

Prisma doesn't support pgvector indexes. It sees the index as "drift" and generates:

```sql
DROP INDEX "idx_memories_embedding"  -- 100x slower queries!
```

### The Solution

**NEVER run `prisma migrate dev` directly.** Always:

```bash
# 1. Generate only
npx prisma migrate dev --create-only --name your_name

# 2. REVIEW the SQL - delete any DROP INDEX lines!
cat prisma/migrations/<timestamp>/migration.sql

# 3. Apply
npx prisma migrate deploy
```

**Pre-commit hook** automatically blocks commits with `DROP INDEX.*idx_memories_embedding`.

### If Index Was Dropped

```sql
CREATE INDEX IF NOT EXISTS idx_memories_embedding
ON memories USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 50);
```

## Vector Operations

### Storing Embeddings

```typescript
const embeddingStr = `[${embedding.join(',')}]`;
await prisma.$executeRaw`
  INSERT INTO memories (id, "personalityId", content, embedding, "createdAt")
  VALUES (gen_random_uuid(), ${id}::uuid, ${content}, ${embeddingStr}::vector, NOW())
`;
```

### Similarity Search

```typescript
// Cosine distance: 0 = identical, 2 = opposite
const results = await prisma.$queryRaw<SimilarMemory[]>`
  SELECT id, content, 1 - (embedding <-> ${embeddingStr}::vector) as similarity
  FROM memories
  WHERE "personalityId" = ${personalityId}::uuid
  ORDER BY embedding <-> ${embeddingStr}::vector
  LIMIT ${limit}
`;
```

## Migration Workflow

### The One True Workflow

```bash
# 1. Create (don't apply)
npx prisma migrate dev --create-only --name descriptive_name

# 2. Review SQL - remove any DROP INDEX for vector indexes
cat prisma/migrations/<timestamp>/migration.sql

# 3. Apply
npx prisma migrate deploy
```

### Idempotent Migrations

```sql
-- ✅ GOOD - Safe to run multiple times
DROP TRIGGER IF EXISTS my_trigger ON my_table;
CREATE TRIGGER my_trigger...

DROP FUNCTION IF EXISTS my_function() CASCADE;
CREATE OR REPLACE FUNCTION my_function()...

CREATE INDEX IF NOT EXISTS idx_name ON table(column);

-- ❌ BAD - Fails if exists
CREATE TRIGGER my_trigger...
CREATE INDEX idx_name ON table(column);
```

### Anti-Patterns

| ❌ Don't                             | ✅ Instead                           |
| ------------------------------------ | ------------------------------------ |
| Run SQL manually then mark applied   | Use `migrate deploy`                 |
| Edit applied migrations              | Create new migration to fix          |
| Use `railway run prisma migrate dev` | Run locally with `.env` DATABASE_URL |

## 🔧 Migration Drift Resolution (IMPORTANT)

### What Is Drift?

Drift occurs when a migration file is modified after being applied to the database. Prisma stores a checksum of each migration in `_prisma_migrations` and compares it when running new migrations.

**Common causes:**
- Formatting changes (Prettier, trailing whitespace)
- Adding comments
- Git merge conflicts resolved differently
- Accidental edits

### Detecting Drift

```bash
# Check all migrations for drift
pnpm --filter @tzurot/scripts run db:check-drift

# Output shows:
# ✅ 20251201221930_add_share_ltm_flag: OK
# ❌ 20251213200000_add_tombstones: DRIFT DETECTED
#    DB:   2c6cb23b9477f0cea8df...
#    File: ac8449de6c87c14856f9...
```

### Fixing Drift Non-Destructively

**When safe to fix (update checksum):**
- Formatting/whitespace changes only
- Added comments
- No actual SQL logic changes

```bash
# Fix specific migration(s)
pnpm --filter @tzurot/scripts run db:fix-drift -- <migration_name>

# Example:
pnpm --filter @tzurot/scripts run db:fix-drift -- 20251213200000_add_tombstones
```

This updates the checksum in `_prisma_migrations` to match the current file.

**When NOT to fix (create new migration):**
- Actual SQL logic was changed
- Table/column definitions differ from what was applied
- Indexes or constraints were modified

### Why NOT Use `prisma migrate reset`?

`prisma migrate reset` **DESTROYS ALL DATA**. Never use it on a shared development or production database. The non-destructive approach preserves all data while fixing the checksum mismatch.

### Why NOT Use `prisma migrate resolve`?

`prisma migrate resolve --applied` marks a migration as applied without running it. This is dangerous because:
- It doesn't verify the schema matches
- It can leave the database in an inconsistent state
- It's meant for disaster recovery, not routine drift

### Preventing Drift

1. **Don't edit applied migrations** - Create new ones instead
2. **Use `--create-only`** - Review before applying
3. **Run drift check in CI** - Catch issues early
4. **Commit migration files immediately** - Before they can drift

## Database Scripts

Located in `scripts/src/db/`:

```bash
pnpm --filter @tzurot/scripts run db:check-drift
pnpm --filter @tzurot/scripts run db:fix-drift -- <migration_name>
```

## Query Patterns

```typescript
// ✅ Use include to avoid N+1
const personalities = await prisma.personality.findMany({
  include: { llmConfig: true },
});

// ✅ Cursor-based pagination for large datasets
const messages = await prisma.conversationHistory.findMany({
  take: limit + 1,
  cursor: cursor ? { id: cursor } : undefined,
  skip: cursor ? 1 : 0,
  orderBy: { createdAt: 'desc' },
});
```

## Railway-Specific Notes

- `.env` contains `DATABASE_URL` for Railway dev database
- No local PostgreSQL needed - work directly against Railway
- Migrations run on api-gateway startup
- Push migration files to git → Railway auto-deploys

## Related Skills

- **tzurot-types** - Prisma schema and type definitions
- **tzurot-observability** - Query logging
- **tzurot-architecture** - Database service placement

## References

- Prisma docs: https://www.prisma.io/docs
- pgvector docs: https://github.com/pgvector/pgvector
- Schema: `prisma/schema.prisma`
- Drift docs: `docs/database/PRISMA_DRIFT_ISSUES.md`
