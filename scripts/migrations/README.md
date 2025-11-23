# Database Migration Scripts

Scripts for managing Prisma database migrations and schema changes.

## Scripts

- **fix-migration-checksums.ts** - Fix migration checksum mismatches after manual edits
- **verify-migration-checksums.ts** - Verify all migration checksums match expected values
- **migration-helper.sh** - Run migrations on Railway environments with safety checks
- **migrate-persona-all-in-one.sql** - Legacy SQL migration for persona schema changes

## Usage

```bash
# Create a new migration (from project root, not scripts/)
npx prisma migrate dev --create-only --name migration_name

# Apply migrations on Railway
./scripts/migrations/migration-helper.sh production

# Fix checksum issues
npx tsx scripts/migrations/fix-migration-checksums.ts
```

**⚠️ See:** `tzurot-db-vector` skill for complete migration workflow and troubleshooting
