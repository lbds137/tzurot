# Database Migration Scripts

Scripts for managing Prisma database migrations and schema changes.

## Scripts

- **migration-helper.sh** - Run migrations on Railway environments with safety checks
- **migrate-persona-all-in-one.sql** - Legacy SQL migration for persona schema changes

## Usage

```bash
# Create a new migration (from project root, not scripts/)
npx prisma migrate dev --create-only --name migration_name

# Apply migrations on Railway
./scripts/migrations/migration-helper.sh production

# Check / fix migration checksum + drift issues (the standalone checksum scripts
# were removed; the ops tooling supersedes them)
pnpm ops db:check-drift
pnpm ops db:fix-drift
```

**⚠️ See:** `tzurot-db-vector` skill for complete migration workflow and troubleshooting
