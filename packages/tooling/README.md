# @tzurot/tooling

Internal tooling package for Tzurot v3 monorepo operations.

## Usage

```bash
# See all available commands
pnpm ops --help

# Run ANY script with Railway DATABASE_URL
pnpm ops run --env dev <command>          # Inject dev DATABASE_URL
pnpm ops run --env prod --force <command> # Inject prod DATABASE_URL

# Shortcut (from root)
pnpm with-env dev tsx scripts/src/db/backfill-local-embeddings.ts

# Database operations
pnpm ops db:check-drift      # Check for migration drift
pnpm ops db:fix-drift <name> # Fix drifted migrations
pnpm ops db:inspect          # Inspect database state
pnpm ops db:status --env dev # Migration status on Railway dev
pnpm ops db:migrate --env dev # Run migrations on Railway dev

# Data operations
pnpm ops data:import <name>  # Import a personality
pnpm ops data:bulk-import    # Bulk import all

# Codebase analysis (xray)
pnpm ops xray                # Full analysis (terminal)
pnpm ops xray --summary      # File-level overview (no declarations)
pnpm ops xray bot-client     # Single package
pnpm ops xray --format md    # Markdown output (for LLMs)
pnpm ops xray --format json  # JSON output (for tooling)

# Deployment
pnpm ops deploy:dev          # Deploy to Railway dev
pnpm ops deploy:verify       # Verify build

# Cache management
pnpm ops cache:inspect       # Show cache size and stats
pnpm ops cache:clear         # Clear Turborepo cache
pnpm ops cache:clear --dry-run  # Preview without deleting
```

## Running Scripts Against Railway Databases

The `ops run` command provides a **generic way to run any script** with Railway database credentials injected. This avoids needing to add specific ops commands for every one-off script.

### How It Works

1. Fetches `DATABASE_PUBLIC_URL` from Railway via the CLI
2. Injects it as `DATABASE_URL` into the spawned process
3. Runs your command with stdio inherited (interactive scripts work)

### Examples

```bash
# Run a one-off script directly (no npm script needed)
pnpm ops run --env dev tsx scripts/src/db/backfill-local-embeddings.ts

# Run Prisma Studio against Railway dev
pnpm ops run --env dev npx prisma studio

# Run a reusable npm script (for scripts that may be run multiple times)
pnpm ops run --env dev pnpm --filter @tzurot/scripts run db:fix-phantom

# Production operations (requires confirmation or --force)
pnpm ops run --env prod --force npx prisma migrate deploy
```

### Shortcut

For convenience, use the `with-env` shortcut from the root:

```bash
pnpm with-env dev tsx scripts/src/db/backfill-local-embeddings.ts
```

### When to Use npm Scripts vs Direct Execution

| Pattern                        | Use When                                     |
| ------------------------------ | -------------------------------------------- |
| `tsx scripts/src/db/script.ts` | One-off scripts (migrations, backfills)      |
| `pnpm --filter pkg run script` | Reusable scripts that may run multiple times |

## Architecture

```
packages/tooling/
├── src/
│   ├── cli.ts              # Main CLI entry point (cac)
│   ├── commands/           # Command registrations
│   │   ├── db.ts           # Database commands
│   │   ├── data.ts         # Data import/export commands
│   │   ├── deploy.ts       # Deployment commands
│   │   ├── cache.ts        # Cache management commands
│   │   └── xray.ts         # Codebase analysis commands
│   ├── db/                 # Database utilities
│   ├── data/               # Data import utilities
│   ├── deployment/         # Deployment utilities
│   ├── cache/              # Cache management utilities
│   ├── xray/               # TypeScript AST analysis
│   │   ├── analyzer.ts     # Orchestrator (discover → parse → format)
│   │   ├── file-discovery.ts # Package/file scanning
│   │   ├── file-parser.ts  # ts-morph AST + suppression extraction
│   │   └── formatters/     # terminal, markdown, json output
│   └── eslint/             # Custom ESLint rules
└── package.json
```

## Design Principles

1. **Lazy Loading**: Commands dynamically import their implementations for fast CLI startup
2. **Unified Interface**: One CLI (`pnpm ops`) instead of many scattered scripts
3. **Type Safety**: Full TypeScript with shared types from `@tzurot/common-types`
4. **Progressive Migration**: Legacy scripts remain functional while being migrated

## Adding New Commands

1. Create implementation in appropriate subdirectory (e.g., `src/db/new-command.ts`)
2. Export an async function that performs the operation
3. Register in the corresponding command file (e.g., `src/commands/db.ts`)
4. Add options using `cac`'s fluent API

Example:

```typescript
// src/db/new-command.ts
export async function newCommand(options: { verbose?: boolean }): Promise<void> {
  // Implementation
}

// src/commands/db.ts
cli
  .command('db:new-command', 'Description here')
  .option('--verbose', 'Verbose output')
  .action(async options => {
    const { newCommand } = await import('../db/new-command.js');
    await newCommand(options);
  });
```

## Turborepo Caching

This monorepo uses [Turborepo](https://turbo.build/repo) for build orchestration and caching.

### Performance Expectations

| Scenario                 | Expected Time              |
| ------------------------ | -------------------------- |
| First run (cold cache)   | 2-3 minutes                |
| Subsequent runs (cached) | 5-15 seconds               |
| Docs-only changes        | <5 seconds (tests skipped) |

### Cache Behavior

- **Cache location**: `.turbo/` directory (gitignored)
- **Cache invalidation**: Automatic based on file inputs defined in `turbo.json`
- **Cache hits**: Displayed as `cached` in turbo output

### Common Commands

```bash
# Normal build (uses cache)
pnpm turbo run build

# Force rebuild (ignore cache)
pnpm turbo run build --force

# Clear cache manually
rm -rf .turbo

# See what would run without cache
pnpm turbo run build --dry-run
```

### Troubleshooting

**Cache not working?**

- Check `turbo.json` inputs match your file patterns
- Ensure no untracked files affect build output
- Run `pnpm turbo run build --force` to rebuild

**Cache growing too large?**

- Safe to delete: `rm -rf .turbo`
- Cache rebuilds automatically on next run

## Migration from Old Hooks

This project migrated from custom `hooks/` scripts to [Husky](https://typicode.github.io/husky/) in PR #455.

### What Changed

| Before                              | After                                |
| ----------------------------------- | ------------------------------------ |
| `hooks/pre-commit` (manual install) | `.husky/pre-commit` (auto-installed) |
| `hooks/commit-msg` (manual install) | `.husky/commit-msg` (auto-installed) |
| `hooks/pre-push` (manual install)   | `.husky/pre-push` (auto-installed)   |
| Manual: `./hooks/install.sh`        | Automatic via `pnpm install`         |

### Key Behavior Changes

1. **Auto-installation**: Hooks install automatically on `pnpm install` (via `prepare` script)
2. **Lint-staged**: Pre-commit only runs linters on staged files (much faster)
3. **Turbo integration**: Pre-push uses Turborepo for cached builds
4. **Docs skip**: Pre-push skips tests for documentation-only changes
5. **Secretlint**: Added secret detection to prevent credential commits

### If Hooks Aren't Working

```bash
# Reinstall Husky
pnpm exec husky install

# Verify hooks exist
ls -la .husky/

# Make hooks executable (if needed)
chmod +x .husky/*
```

## Custom ESLint Rules

This package provides custom ESLint rules for the Tzurot codebase.

### `@tzurot/no-singleton-export`

**Status**: ✅ Integrated in `eslint.config.js` (warning level)

Detects singleton anti-patterns where modules export instantiated objects, making code harder to test.

```typescript
// ❌ BAD - Instance created at import time
const manager = new PersonalityManager();
export default manager;

export default new PersonalityManager();
export default { mgr: new PersonalityManager() };
export const instances = [new Foo(), new Bar()];

// ✅ GOOD - Export class or factory
export class PersonalityManager { ... }
export function createPersonalityManager() {
  return new PersonalityManager();
}
```

**To enable** (in `eslint.config.js`):

```javascript
import tzurotPlugin from '@tzurot/tooling/eslint';

export default [
  // ... other configs
  {
    plugins: { '@tzurot': tzurotPlugin },
    rules: {
      '@tzurot/no-singleton-export': 'warn',
    },
  },
];
```

## Dependencies

- `cac` - Lightweight CLI framework
- `chalk` - Terminal colors
- `ora` - Spinners for long operations
- `@tzurot/common-types` - Shared types and Prisma client
