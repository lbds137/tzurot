---
name: tzurot-tooling
description: Use when adding CLI commands, dev scripts, or tooling utilities. Covers the ops CLI structure, where scripts belong, and standardized commands for linting/testing.
lastUpdated: '2026-01-11'
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
│   ├── data.ts
│   ├── db.ts
│   ├── deploy.ts
│   └── dev.ts             # Dev workflow commands
├── cache/                 # Cache utilities
├── data/                  # Data import/export
├── db/                    # Database operations
├── deployment/            # Railway deployment
├── dev/                   # Dev workflow (focus-runner)
├── eslint/                # Custom ESLint rules
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

## Why This Structure?

1. **Caching** - Turbo caches results; ad-hoc scripts don't
2. **Discoverability** - `pnpm ops --help` shows all commands
3. **Consistency** - Same patterns across all tooling
4. **Testability** - Tooling modules can have unit tests
5. **Type Safety** - TypeScript throughout

## Related Skills

- **tzurot-code-quality** - ESLint rules, lint fixes
- **tzurot-testing** - Test patterns, coverage
- **tzurot-deployment** - Railway deployment commands
- **tzurot-db-vector** - Database migration commands

## References

- Tooling package: `packages/tooling/`
- Turbo config: `turbo.json`
- Root scripts: `package.json`
