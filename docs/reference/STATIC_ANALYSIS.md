# Static Analysis Tools

## Overview

This document covers the static analysis tooling used in the tzurot monorepo. These tools help maintain code quality by detecting duplication, complexity issues, and type errors in test files.

## Tools

### jscpd - Copy-Paste Detection

Detects duplicated code across the monorepo. Encourages extracting shared logic to `packages/common-types`.

**Commands:**

```bash
pnpm cpd              # Run detection, output to console
pnpm cpd:report       # Generate HTML report in reports/jscpd/
```

**Configuration:** `.jscpd.json`

| Setting     | Value | Purpose                                     |
| ----------- | ----- | ------------------------------------------- |
| `threshold` | 5     | Allow up to 5% total duplication            |
| `minLines`  | 5     | Ignore duplicates shorter than 5 lines      |
| `minTokens` | 50    | Ignore duplicates with fewer than 50 tokens |

Tests are excluded because test boilerplate is often intentionally similar (setup patterns, mock configurations).

**Fixing violations:**

1. Run `pnpm cpd:report` to see detailed HTML report
2. Identify the duplicated code blocks
3. Extract to shared utility in `packages/common-types`
4. Import from the shared location

**Suppressing false positives:**

```typescript
/* jscpd:ignore-start */
// Intentionally duplicated code (explain why)
/* jscpd:ignore-end */
```

Only use suppression when:

- The duplication is intentional and documented
- Extracting would hurt readability more than help
- The code is genuinely different in purpose despite textual similarity

### eslint-plugin-sonarjs - Cognitive Complexity

Measures mental effort required to understand code. More nuanced than cyclomatic complexity because it penalizes nesting.

**Rules enabled:**

| Rule                              | Level | Threshold | Purpose                                 |
| --------------------------------- | ----- | --------- | --------------------------------------- |
| `sonarjs/cognitive-complexity`    | warn  | 15        | Max cognitive complexity per function   |
| `sonarjs/no-identical-functions`  | warn  | -         | Detect duplicate functions in same file |
| `sonarjs/no-duplicate-string`     | warn  | 3         | Detect magic strings (3+ occurrences)   |
| `sonarjs/no-collapsible-if`       | warn  | -         | Detect collapsible if statements        |
| `sonarjs/no-redundant-jump`       | warn  | -         | Detect unnecessary returns/continues    |
| `sonarjs/prefer-immediate-return` | warn  | -         | Prefer direct returns over temp vars    |

**Cognitive Complexity vs Cyclomatic Complexity:**

- **Cyclomatic complexity** counts decision points (branches)
- **Cognitive complexity** weights nesting depth and adds penalties for breaks in linear flow

Example where cognitive > cyclomatic:

```typescript
// Cyclomatic: 3 (three if statements)
// Cognitive: 6 (nested ifs get +2, +3 penalties)
function example(a: boolean, b: boolean, c: boolean): void {
  if (a) {
    if (b) {
      if (c) {
        doSomething();
      }
    }
  }
}
```

**Fixing cognitive complexity:**

1. Extract nested conditionals to helper functions
2. Use early returns to reduce nesting
3. Replace complex switch statements with lookup objects
4. Break large functions into smaller, focused functions

**Example refactor:**

```typescript
// Before (cognitive complexity: 12)
function processOrder(order: Order): Result {
  if (order.isValid) {
    if (order.hasItems) {
      if (order.isPaid) {
        // ... more nesting
      }
    }
  }
}

// After (cognitive complexity: 3)
function processOrder(order: Order): Result {
  if (!order.isValid) return { error: 'Invalid order' };
  if (!order.hasItems) return { error: 'No items' };
  if (!order.isPaid) return { error: 'Not paid' };

  return processValidOrder(order);
}
```

### Test File Type Checking

Tests are excluded from the main build (`tsconfig.json`) but type-checked separately.

**Why separate?**

- **Build performance**: Tests don't need to be in `dist/`
- **Type isolation**: Test globals (vitest) don't pollute production code
- **Error detection**: Catch type errors in tests that previously went unnoticed

**Commands:**

```bash
pnpm typecheck       # Type-check source files only
pnpm typecheck:spec  # Type-check source AND test files
```

**Configuration:**

Each package has `tsconfig.spec.json` that extends the main `tsconfig.json` but:

- Sets `noEmit: true` (no output)
- Removes the `exclude: ["**/*.test.ts"]` pattern
- Disables composite mode (not part of project references)

**Common test type errors:**

1. **Mock type mismatches**: Ensure mocks implement the full interface
2. **Missing assertions**: Use proper type assertions in test setup
3. **Stale type imports**: Update imports when source types change

## CI Integration

- **Pre-push hook**: Runs `typecheck:spec` and `cpd` (both warnings until baseline fixed)
- **CI pipeline**: `typecheck:spec` is blocking; `cpd` has `continue-on-error: true`

## Quality Command

`pnpm quality` runs the full quality suite:

1. `pnpm lint` - ESLint with sonarjs rules
2. `pnpm cpd` - Copy-paste detection
3. `pnpm typecheck:spec` - Test file type checking

Run this before submitting PRs to catch issues early.

## Thresholds and Rationale

| Tool                 | Threshold | Why This Value                                  |
| -------------------- | --------- | ----------------------------------------------- |
| jscpd threshold      | 5%        | Conservative; allows some duplication initially |
| Cognitive complexity | 15        | Matches cyclomatic limit; balances readability  |
| Duplicate strings    | 3         | Catches magic strings without over-triggering   |

Future work: Once violations are reduced, consider lowering CPD threshold to 2-3%.

## Troubleshooting

### jscpd reports are too large

The `minLines` and `minTokens` settings filter out trivial duplicates. If you're still seeing too many results:

1. Check if the duplication is in test files (should be excluded)
2. Verify `.jscpd.json` ignore patterns are correct
3. Consider if the threshold is appropriate for the codebase maturity

### Cognitive complexity warnings on valid code

Some patterns (like command handlers with many cases) inherently have higher complexity. Options:

1. Refactor to lookup tables or strategy pattern
2. Disable the rule for specific files (not recommended)
3. Accept the warning if the code is genuinely the clearest approach

### Test typecheck finds many errors

This is expected on first run if tests were never type-checked. Prioritize:

1. Import errors (missing or wrong imports)
2. Mock type mismatches
3. Assertion type issues

Use `// @ts-expect-error` sparingly and only with comments explaining why.

## Making Static Analysis Blocking

Currently, static analysis checks run as **warnings** to allow time to fix baseline violations. Once violations are resolved:

### Steps to Make Checks Blocking

1. **CPD (CI)**: Remove `continue-on-error: true` from `.github/workflows/ci.yml` (line ~47)

2. **typecheck:spec (Pre-push)**: Already blocking in CI. To make blocking in pre-push, move it back into the main turbo command in `.husky/pre-push`:

   ```bash
   # Change from separate warning step to blocking
   pnpm turbo run build lint test typecheck:spec $TURBO_FILTER $TURBO_ARGS
   ```

3. **CPD (Pre-push)**: Change from warning to blocking by adding `exit 1`:
   ```bash
   if ! pnpm cpd 2>/dev/null; then
       echo "${RED}Copy-paste detection found violations${NC}"
       exit 1
   fi
   ```

### Target State

| Check          | Target                    | When to Make Blocking           |
| -------------- | ------------------------- | ------------------------------- |
| CPD            | Under 3% duplication      | After extracting shared utils   |
| typecheck:spec | Zero test type errors     | After fixing all test types     |
| sonarjs        | Zero cognitive violations | After refactoring complex funcs |

### Tracking Progress

Run `pnpm quality` to see current violation counts. Track progress in BACKLOG.md under "Fix Static Analysis Baseline Violations".
