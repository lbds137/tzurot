# Scripts Directory

Utility scripts for Tzurot v3 development, deployment, and maintenance.

> **Note**: Most active scripts have been migrated to `packages/tooling` and are accessible via the `pnpm ops` CLI. This directory contains legacy scripts being migrated and specialized tools.

## 🚀 Quick Start: The `ops` CLI

The recommended way to run operations is via the unified CLI:

```bash
# See all available commands
pnpm ops --help

# Database operations
pnpm ops db:check-drift      # Check for migration drift
pnpm ops db:fix-drift <name> # Fix drifted migrations
pnpm ops db:inspect          # Inspect database state
pnpm ops db:inspect --table memories  # Inspect specific table

# Data operations
pnpm ops data:import <personality>  # Import a personality
pnpm ops data:bulk-import           # Bulk import all
pnpm ops data:backup                # Backup personality data

# Deployment
pnpm ops deploy:dev           # Deploy to Railway dev
pnpm ops deploy:verify        # Verify build
```

## 📁 Directory Structure

### Active Scripts (Legacy - Being Migrated)

| Directory                      | Purpose                   | Migration Status        |
| ------------------------------ | ------------------------- | ----------------------- |
| **[git/](git/)**               | SSH setup, branch sync    | Hooks → Husky           |
| **[deployment/](deployment/)** | Railway deployment        | → `pnpm ops deploy:*`   |
| **[migrations/](migrations/)** | Prisma migration helpers  | → `pnpm ops db:*`       |
| **[data/](data/)**             | Personality import/export | → `pnpm ops data:*`     |
| **[debug/](debug/)**           | Database debugging        | → `pnpm ops db:inspect` |
| **[testing/](testing/)**       | Test analysis utilities   | Staying here            |
| **[analysis/](analysis/)**     | Code pattern analysis     | → ESLint rules          |
| **[utils/](utils/)**           | General utilities         | Mixed                   |

### New Home: `packages/tooling`

Active development has moved to `packages/tooling/`:

- TypeScript-first with full type safety
- Unified CLI via `cac`
- Proper workspace package with dependencies
- Dynamic imports for fast startup

## 🔧 Git Hooks

Git hooks are now managed by **Husky** (auto-installed on `pnpm install`):

| Hook         | Tool        | Purpose                       |
| ------------ | ----------- | ----------------------------- |
| `pre-commit` | lint-staged | Format & lint staged files    |
| `pre-commit` | secretlint  | Scan for secrets              |
| `commit-msg` | commitlint  | Validate conventional commits |
| `pre-push`   | Turborepo   | Cached build/lint/test        |

**Configuration files:**

- `.husky/` - Hook scripts
- `.lintstagedrc.json` - lint-staged config
- `.secretlintrc.json` - secretlint rules
- `commitlint.config.cjs` - commit message rules

See `scripts/git/README.md` for details.

## 📝 Versioning with Changesets

Version management uses **Changesets** instead of the legacy `bump-version.sh`:

```bash
# Add a changeset for your changes
pnpm changeset

# Check pending changesets
pnpm changeset:status

# Apply changesets and bump versions
pnpm changeset:version
```

The legacy `pnpm bump-version` still works for manual version bumps.

## ⚠️ Important Notes

### Running Scripts

Run scripts from the **project root**:

```bash
# ✅ Correct
pnpm ops db:inspect
./scripts/deployment/deploy-railway-dev.sh

# ❌ Wrong
cd scripts && ./deployment/deploy-railway-dev.sh
```

### TypeScript Scripts

Use `tsx` for TypeScript scripts not yet migrated to the ops CLI:

```bash
# Ad-hoc execution
pnpm tsx scripts/data/rebuild-memories-from-history.ts

# Or via package.json scripts
pnpm import-personality
pnpm bulk-import
```

### Railway CLI

Deployment scripts require Railway CLI:

```bash
npm install -g @railway/cli
railway login
```

**See:** `docs/reference/RAILWAY_CLI_REFERENCE.md`

## 📖 Related Documentation

- **[packages/tooling/](../packages/tooling/)** - The new ops CLI package
- **[docs/reference/deployment/RAILWAY_OPERATIONS.md](../docs/reference/deployment/RAILWAY_OPERATIONS.md)** - Railway guide
- **[docs/guides/DEVELOPMENT.md](../docs/guides/DEVELOPMENT.md)** - Local setup

## 🎯 Claude Code Skills

Related skills for operations:

- **tzurot-deployment** - Railway operations
- **tzurot-db-vector** - Database operations
- **tzurot-testing** - Testing patterns
- **tzurot-git-workflow** - Git workflow
- **tzurot-observability** - Logging and debugging
