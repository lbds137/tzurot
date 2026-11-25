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

By convention, run scripts from the **project root** with root-relative paths:

```bash
pnpm ops db:inspect
node scripts/testing/check-untested-files.js
```

### Railway CLI

Most commands that take `--env dev|prod` need the Railway CLI installed, logged in, and linked: `deploy:setup-vars` and `logs` call it directly, and many others reach it through `packages/tooling/src/utils/env-runner.ts`. `deploy:var-delete`, `deploy:redeploy`, and `deploy:watch-check` use it to resolve service/environment ids through `railway status --json`.

`deploy:var-delete`, `deploy:redeploy`, and `deploy:watch-check` also use a Railway API token (`TZUROT_RAILWAY_API_TOKEN_DEV` / `_PROD`) for the GraphQL-API operations the CLI lacks: variable deletion, image-reusing redeploy, and reading a service's watch patterns.

```bash
npm install -g @railway/cli
railway login
```

**See:** `docs/reference/RAILWAY_CLI_REFERENCE.md`

## 📖 Related Documentation

- **[packages/tooling/](../packages/tooling/)** - The new ops CLI package
- **[docs/reference/deployment/RAILWAY_OPERATIONS.md](../docs/reference/deployment/RAILWAY_OPERATIONS.md)** - Railway guide
- **[Root README](../README.md)** — local setup: [Quick Start](../README.md#quick-start) and [Development](../README.md#development) sections

## 🎯 Claude Code Skills

Related skills for operations:

- **tzurot-deployment** - Railway operations
- **tzurot-db-vector** - Database operations
- **tzurot-testing** - Testing patterns
- **tzurot-git-workflow** - Git workflow
- **tzurot-observability** - Logging and debugging
