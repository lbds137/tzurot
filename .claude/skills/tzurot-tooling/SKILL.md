---
name: tzurot-tooling
description: Use when adding CLI commands, dev scripts, or tooling utilities. Covers the ops CLI structure, where scripts belong, and standardized commands for linting/testing.
lastUpdated: '2026-01-24'
---

# Tooling & CLI Commands

**Use this skill when:** Adding new CLI commands, creating dev utilities, understanding where scripts belong, or using standardized lint/test commands.

## Quick Reference

```bash
# Standardized commands (use these!)
pnpm lint              # Lint all packages
pnpm lint:errors       # Show only errors (no warnings)
pnpm test              # Test all packages
pnpm test:failures     # Show only failed tests
pnpm typecheck         # Typecheck all packages

# Focused commands (changed packages only)
pnpm focus:lint        # Lint changed packages
pnpm focus:test        # Test changed packages
pnpm focus:typecheck   # Typecheck changed packages
pnpm focus:build       # Build changed packages

# Ops CLI (full power)
pnpm ops dev:lint --errors-only
pnpm ops dev:focus test -- --reporter=verbose
pnpm ops --help
```

## Where Scripts Belong

### ✅ `packages/tooling/` - CLI Commands & Utilities

**Use for:** Reusable tooling, CLI commands, development utilities.

```
packages/tooling/src/
├── cli.ts                 # Main CLI entry (pnpm ops)
├── commands/              # Command registration
│   ├── cache.ts
│   ├── context.ts         # Session context commands
│   ├── data.ts
│   ├── db.ts
│   ├── deploy.ts
│   ├── dev.ts             # Dev workflow commands
│   ├── gh.ts              # GitHub API commands
│   ├── inspect.ts         # Queue/runtime inspection
│   ├── memory.ts          # Memory cleanup commands
│   ├── release.ts         # Version bumping
│   ├── run.ts             # Generic env runner
│   └── test.ts            # Test audit commands
├── cache/                 # Cache utilities
├── context/               # Session context for AI startup
├── data/                  # Data import/export
├── db/                    # Database operations
├── deployment/            # Railway deployment
├── dev/                   # Dev workflow (focus-runner)
├── eslint/                # Custom ESLint rules
├── gh/                    # GitHub API utilities
├── inspect/               # Runtime inspection (queues)
├── memory/                # Memory deduplication
├── release/               # Version management
├── test/                  # Test audit utilities
└── utils/                 # Shared utilities
```

### ✅ `scripts/` - One-off & Data Scripts

**Use for:** Data migrations, one-time operations, CI scripts.

```
scripts/
├── data/                  # Data import scripts
├── testing/               # CI/test utilities
└── utils/                 # Misc utilities (bump-version)
```

### ❌ Anti-Patterns

```typescript
// ❌ WRONG - Ad-hoc script in scripts/ for reusable tooling
scripts/utils/smart-turbo.ts  // Should be in packages/tooling/

// ❌ WRONG - Grep chains in shell
pnpm test 2>&1 | grep -E "error|fail"  // Use pnpm test:failures

// ❌ WRONG - Direct eslint calls in package.json
"lint:errors": "eslint . --quiet"  // Use turbo for caching
```

## Adding New CLI Commands

### Step 1: Create Implementation Module

```typescript
// packages/tooling/src/myfeature/my-command.ts
export interface MyCommandOptions {
  dryRun?: boolean;
}

export async function runMyCommand(options: MyCommandOptions): Promise<void> {
  // Implementation
}
```

### Step 2: Register in commands/

```typescript
// packages/tooling/src/commands/myfeature.ts
import type { CAC } from 'cac';

export function registerMyFeatureCommands(cli: CAC): void {
  cli
    .command('myfeature:action', 'Description of action')
    .option('--dry-run', 'Preview without changes')
    .action(async (options: { dryRun?: boolean }) => {
      const { runMyCommand } = await import('../myfeature/my-command.js');
      await runMyCommand(options);
    });
}
```

### Step 3: Register in cli.ts

```typescript
// packages/tooling/src/cli.ts
import { registerMyFeatureCommands } from './commands/myfeature.js';

// ...
registerMyFeatureCommands(cli);
```

### Step 4: Add Package.json Shortcut (Optional)

```json
{
  "scripts": {
    "myfeature": "pnpm ops myfeature:action"
  }
}
```

## Turbo Integration

All CI-like commands should use Turbo for caching:

```json
{
  "scripts": {
    "lint": "turbo run lint",
    "lint:errors": "turbo run lint --output-logs=errors-only -- --quiet --format=pretty"
  }
}
```

**Key flags:**

- `--output-logs=errors-only` - Only show output from failed tasks
- `-- --quiet` - Pass `--quiet` to eslint (suppress warnings)
- `-- --format=pretty` - Use pretty formatter for errors

## Dev Commands Reference

| Command                           | Description                            |
| --------------------------------- | -------------------------------------- |
| `pnpm ops dev:lint`               | Lint changed packages                  |
| `pnpm ops dev:lint --all`         | Lint all packages                      |
| `pnpm ops dev:lint --errors-only` | Lint with only errors shown            |
| `pnpm ops dev:test`               | Test changed packages                  |
| `pnpm ops dev:test --all`         | Test all packages                      |
| `pnpm ops dev:typecheck`          | Typecheck changed packages             |
| `pnpm ops dev:focus <task>`       | Run any turbo task on changed packages |

## Testing Requirements

**All tooling code must have unit tests.** The tooling package follows the same coverage requirements as other packages.

```bash
# Run tooling tests
pnpm --filter @tzurot/tooling test
```

When adding new tooling:

1. **Implementation modules** (`src/myfeature/*.ts`) - Must have `*.test.ts`
2. **Command registration** (`src/commands/*.ts`) - No tests needed (thin wrappers)
3. **Utilities** (`src/utils/*.ts`) - Must have `*.test.ts`

Test examples exist at:

- `packages/tooling/src/dev/focus-runner.test.ts`
- `packages/tooling/src/eslint/*.test.ts`

## Database Commands Reference

| Command                               | Description                              |
| ------------------------------------- | ---------------------------------------- |
| `pnpm ops db:status --env <env>`      | Show migration status (applied, pending) |
| `pnpm ops db:migrate --env <env>`     | Run pending migrations (interactive)     |
| `pnpm ops db:migrate --dry-run`       | Preview without applying                 |
| `pnpm ops db:deploy --env <env>`      | Deploy migrations (non-interactive, CI)  |
| `pnpm ops db:check-drift --env <env>` | Check schema vs database drift           |
| `pnpm ops db:fix-drift <migrations>`  | Fix migration drift issues               |
| `pnpm ops db:inspect --env <env>`     | Inspect database state                   |
| `pnpm ops db:inspect --table <name>`  | Inspect specific table                   |
| `pnpm ops db:inspect --indexes`       | Show only indexes                        |
| `pnpm ops db:safe-migrate`            | Create migration with validation         |
| `pnpm ops db:check-safety`            | Check for dangerous patterns             |

**Environment options:** `local` (default), `dev`, `prod`

**Common options:**

- `--migrations-path <path>` - Custom migrations directory (db:status, db:check-drift, db:check-safety)
- `--force` - Skip confirmation for production (db:migrate)
- `--verbose` - Show detailed output (db:check-safety)

## Run Command Reference

**Run any command with Railway DATABASE_URL injected:**

```bash
pnpm ops run --env <env> <command> [args...]
```

| Command                                           | Description                      |
| ------------------------------------------------- | -------------------------------- |
| `pnpm ops run --env dev tsx scripts/my-script.ts` | Run script with dev DATABASE_URL |
| `pnpm ops run --env prod npx prisma studio`       | Open Prisma Studio against prod  |
| `pnpm ops run --env dev --force <cmd>`            | Skip confirmation for prod ops   |

**When to use:** One-off scripts that need database access without adding dedicated ops commands.

## Memory Commands Reference

**Commands for analyzing and managing pgvector memories:**

| Command                             | Description                           |
| ----------------------------------- | ------------------------------------- |
| `pnpm ops memory:analyze --env dev` | Analyze duplicate memories            |
| `pnpm ops memory:analyze --verbose` | Show detailed breakdown               |
| `pnpm ops memory:cleanup --env dev` | Remove duplicate memories             |
| `pnpm ops memory:cleanup --dry-run` | Preview what would be deleted         |
| `pnpm ops memory:cleanup --force`   | Skip confirmation (required for prod) |

**Use case:** After migrations or data imports, check for and clean up duplicate memory embeddings.

## Context Commands Reference

**Quick codebase state for AI session startup:**

| Command                              | Description                   |
| ------------------------------------ | ----------------------------- |
| `pnpm ops context`                   | Show full session context     |
| `pnpm ops context --verbose`         | Include detailed file lists   |
| `pnpm ops context --skip-migrations` | Skip migration check (faster) |

**Output includes:**

- Git branch and recent commits
- Uncommitted changes summary
- CURRENT_WORK.md excerpt
- Next ROADMAP.md items
- Pending migrations (optional)

**Use case:** Run at start of AI session to quickly understand project state.

## Inspect Commands Reference

**Runtime state inspection for debugging:**

| Command                                    | Description              |
| ------------------------------------------ | ------------------------ |
| `pnpm ops inspect:queue`                   | Show BullMQ queue stats  |
| `pnpm ops inspect:queue --env prod`        | Inspect production queue |
| `pnpm ops inspect:queue --verbose`         | Show job payloads        |
| `pnpm ops inspect:queue --failed-limit 10` | Show more failed jobs    |

**Output includes:**

- Queue counts (waiting, active, completed, failed)
- Recent failed jobs with error messages
- Active job details (in verbose mode)

**Use case:** Debug BullMQ/async issues, check for stuck or failed jobs.

## Release Commands Reference

**Version management:**

| Command                                 | Description                 |
| --------------------------------------- | --------------------------- |
| `pnpm ops release:bump 3.0.0-beta.49`   | Bump all package.json files |
| `pnpm ops release:bump 3.0.0 --dry-run` | Preview without changes     |

**Use case:** Bump version across monorepo before release.

## GitHub Commands Reference

**🚨 Use these instead of `gh pr edit` (which is broken):**

| Command                                    | Description                    |
| ------------------------------------------ | ------------------------------ |
| `pnpm ops gh:pr-info <n>`                  | Get PR title, body, state      |
| `pnpm ops gh:pr-reviews <n>`               | Get all reviews on a PR        |
| `pnpm ops gh:pr-comments <n>`              | Get line-level review comments |
| `pnpm ops gh:pr-conversation <n>`          | Get conversation comments      |
| `pnpm ops gh:pr-edit <n> --title "..."`    | Edit PR title                  |
| `pnpm ops gh:pr-edit <n> --body "..."`     | Edit PR body                   |
| `pnpm ops gh:pr-edit <n> --body-file f.md` | Edit PR body from file         |
| `pnpm ops gh:pr-all <n>`                   | Get all PR info at once        |

These use `gh api` directly, bypassing the broken GraphQL calls.

## Test Audit Commands Reference

**Ratchet audits** to enforce test coverage (CI runs these automatically):

| Command                                  | Description                                  |
| ---------------------------------------- | -------------------------------------------- |
| `pnpm ops test:audit`                    | Run both contract and service audits         |
| `pnpm ops test:audit-contracts`          | Audit API schema contract test coverage      |
| `pnpm ops test:audit-services`           | Audit service component test coverage        |
| `pnpm ops test:audit --strict`           | Fail on ANY gap (not just new ones)          |
| `pnpm ops test:audit-contracts --update` | Update baseline after adding contract tests  |
| `pnpm ops test:audit-services --update`  | Update baseline after adding component tests |

**How ratchets work:**

- Baselines track known gaps (`contract-coverage-baseline.json`, `service-integration-baseline.json`)
- CI passes if no NEW gaps are introduced
- Use `--update` to accept current state after closing gaps
- Use `--strict` to see ALL gaps (existing + new)

See `tzurot-testing` skill for chip-away workflow details.

## Why This Structure?

1. **Caching** - Turbo caches results; ad-hoc scripts don't
2. **Discoverability** - `pnpm ops --help` shows all commands
3. **Consistency** - Same patterns across all tooling
4. **Testability** - Tooling modules can have unit tests
5. **Type Safety** - TypeScript throughout

## Package.json Shortcuts

Root `package.json` provides shortcuts for common ops CLI commands:

| Script                 | Maps To                         | Description              |
| ---------------------- | ------------------------------- | ------------------------ |
| `pnpm focus:lint`      | `pnpm ops dev:lint`             | Lint changed packages    |
| `pnpm focus:test`      | `pnpm ops dev:test`             | Test changed packages    |
| `pnpm focus:build`     | `pnpm ops dev:focus build`      | Build changed packages   |
| `pnpm test:summary`    | `pnpm ops dev:test-summary`     | Summarize test results   |
| `pnpm audit:*`         | `pnpm ops test:audit-*`         | Coverage ratchet audits  |
| `pnpm with-env`        | `pnpm ops run --env`            | Run with Railway env     |
| `pnpm bump-version`    | `pnpm ops release:bump`         | Bump monorepo version    |
| `pnpm generate:pglite` | `pnpm ops test:generate-schema` | Regenerate PGLite schema |

**Note:** Data import scripts use original implementations (not yet migrated):

- `pnpm import-personality` → `tsx scripts/data/import-personality/import-personality.ts`
- `pnpm bulk-import` → `tsx scripts/data/import-personality/bulk-import.ts`
- (ops `data:*` commands are stubs pointing to these originals)

## Related Skills

- **tzurot-code-quality** - ESLint rules, lint fixes
- **tzurot-testing** - Test patterns, coverage
- **tzurot-deployment** - Railway deployment commands
- **tzurot-db-vector** - Database migration commands
- **tzurot-git-workflow** - Git operations, PR workflow

## References

- Tooling package: `packages/tooling/`
- Turbo config: `turbo.json`
- Root scripts: `package.json`
