# Scripts Directory

Utility scripts for Tzurot v3 development, deployment, and maintenance.

## 📁 Directory Structure

All scripts are now organized by purpose into categorized subdirectories:

### Active Scripts

- **[git/](git/)** - Git hooks, SSH setup, branch synchronization
- **[deployment/](deployment/)** - Railway deployment, environment setup, releases
- **[migrations/](migrations/)** - Database schema migrations (Prisma)
- **[data/](data/)** - Data import/export, backups, memory operations
- **[debug/](debug/)** - Database and system debugging tools
- **[testing/](testing/)** - Test analysis and quality utilities
- **[analysis/](analysis/)** - Code quality and pattern analysis
- **[utils/](utils/)** - General-purpose utilities

### Archive

- **[\_archive/](_archive/)** - Historical and obsolete scripts
  - **[\_archive/qdrant/](_archive/qdrant/)** - Old Qdrant vector DB scripts (v2, obsolete for v3)
  - **[\_archive/v2-migration/](_archive/v2-migration/)** - One-time v2→v3 migration scripts

## 🚀 Quick Start

**Most common operations:**

```bash
# Install git hooks
./scripts/git/install-hooks.sh

# Deploy to Railway dev
./scripts/deployment/deploy-railway-dev.sh

# Run database migration
./scripts/migrations/migration-helper.sh production

# Backup personality data
node scripts/data/backup-personalities-data.js

# Check for test anti-patterns
node scripts/testing/check-test-antipatterns.js
```

## 📚 Documentation

Each subdirectory contains its own README.md with:

- Purpose and scope of scripts in that directory
- Usage examples
- Related skills or documentation references

**Start by exploring the subdirectory READMEs for detailed information.**

## 🔍 Finding the Right Script

**Need to...**

- **Setup git hooks?** → `git/`
- **Deploy to Railway?** → `deployment/`
- **Run a database migration?** → `migrations/`
- **Backup or import data?** → `data/`
- **Debug database issues?** → `debug/`
- **Analyze test quality?** → `testing/`
- **Check code patterns?** → `analysis/`
- **Update dependencies?** → `utils/`
- **Find old Qdrant scripts?** → `_archive/qdrant/`
- **Review v2 migration?** → `_archive/v2-migration/`

## ⚠️ Important Notes

### Running Scripts

Most scripts should be run from the **project root**, not from the scripts directory:

```bash
# ✅ Correct (from project root)
./scripts/deployment/deploy-railway-dev.sh

# ❌ Wrong (from scripts directory)
cd scripts && ./deployment/deploy-railway-dev.sh
```

### Archived Scripts

Scripts in `_archive/` are **not maintained** and may not work with current v3 architecture. They are kept for historical reference only.

- **qdrant/** - v2 used Qdrant, v3 uses pgvector
- **v2-migration/** - One-time migrations already complete

### TypeScript Scripts (New Standard)

Scripts are now a proper pnpm workspace package (`@tzurot/scripts`). All new scripts should be written in TypeScript in `src/` and run via pnpm:

```bash
# Run database scripts
pnpm --filter @tzurot/scripts run db:check-drift   # Check for migration drift
pnpm --filter @tzurot/scripts run db:fix-drift -- <migration_name>  # Fix drifted migrations

# Or use the tsx runner directly for ad-hoc scripts
pnpm --filter @tzurot/scripts exec tsx src/db/check-migration-drift.ts
```

**Why this approach?**

- Uses `tsx` which handles ESM/CJS interop automatically
- Proper workspace dependency on `@tzurot/common-types` for Prisma access
- TypeScript provides type safety and better AI assistance
- No more `.mjs` vs `.cjs` vs `.js` confusion

**Writing new scripts:** See `src/db/check-migration-drift.ts` for the template pattern.

### Legacy TypeScript Scripts

Some older `.ts` scripts may still use the direct tsx approach:

```bash
npx tsx scripts/data/rebuild-memories-from-history.ts
```

### Railway CLI

Deployment scripts require Railway CLI to be installed and authenticated:

```bash
npm install -g @railway/cli
railway login
```

**See:** `docs/reference/RAILWAY_CLI_REFERENCE.md` for accurate Railway CLI 4.5.3 commands

## 📖 Related Documentation

- **[docs/deployment/RAILWAY_DEPLOYMENT.md](../docs/deployment/RAILWAY_DEPLOYMENT.md)** - Complete Railway deployment guide
- **[docs/guides/DEVELOPMENT.md](../docs/guides/DEVELOPMENT.md)** - Local development setup
- **[docs/operations/PRISMA_PGVECTOR_REFERENCE.md](../docs/operations/PRISMA_PGVECTOR_REFERENCE.md)** - Database operations

## 🎯 Claude Code Skills

Several scripts relate to project skills:

- **tzurot-deployment** - Railway operations and troubleshooting
- **tzurot-db-vector** - Database migrations and pgvector operations
- **tzurot-testing** - Testing patterns and best practices
- **tzurot-git-workflow** - Git operations and PR workflow

Invoke skills using: `skill: "tzurot-deployment"`

## 📝 Contributing

When adding new scripts:

1. **Place in the correct category directory**
2. **Update that directory's README.md** with the new script
3. **Use descriptive names** (e.g., `backup-personalities-data.js` not `backup.js`)
4. **Add usage examples** in comments or README
5. **Make scripts executable** if they're shell scripts: `chmod +x script.sh`

## 🔄 Migration from Flat Structure

This directory was recently reorganized (2025-11-22) from a flat 60+ file structure into categorized subdirectories.

If you have old references to scripts at the root level, update them:

```bash
# Old path
./scripts/deploy-railway-dev.sh

# New path
./scripts/deployment/deploy-railway-dev.sh
```

All script moves used `git mv` to preserve history.
