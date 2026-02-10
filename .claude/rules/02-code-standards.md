# Code Standards

## ESLint Limits (CI Enforced)

| Rule                     | Limit | Level | Fix Strategy           |
| ------------------------ | ----- | ----- | ---------------------- |
| `max-lines`              | 400   | Error | Split + move tests     |
| `max-lines-per-function` | 100   | Warn  | Extract helpers        |
| `complexity`             | 20    | Warn  | Data-driven approach   |
| `max-depth`              | 4     | Warn  | Early returns, extract |
| `max-params`             | 5     | Warn  | Options object pattern |
| `max-nested-callbacks`   | 3     | Warn  | Extract/flatten        |
| `max-statements`         | 50    | Warn  | Extract helpers        |

**Note**: Test files (`*.test.ts`, `*.spec.ts`) are fully excluded from ESLint
via the `ignores` block in `eslint.config.js`. The limits above apply to
production code only. Do NOT split test files to satisfy max-lines — keep all
tests for a module in one colocated file for discoverability.

## Lint Suppression Standards

When adding `eslint-disable` or `ts-expect-error`, every suppression MUST have a meaningful justification via `--` comment.

| ❌ Banned justifications | ✅ Good justifications                                                 |
| ------------------------ | ---------------------------------------------------------------------- |
| `-- pre-existing`        | `-- Multi-strategy lookup: UUID → name → slug → alias`                 |
| `-- legacy`              | `-- BFS traversal with inherent nested loops`                          |
| `-- tech debt`           | `-- Express router internals are untyped`                              |
| `-- TODO fix later`      | `-- Null guard before property access; collapsing reduces readability` |

Rules:

1. **Describe WHY the code needs the suppression**, not that it's old
2. **If the reason is "this code is messy"** — refactor it instead of suppressing
3. **"pre-existing" is not a justification** — it just means nobody bothered to explain
4. Run `pnpm ops xray --suppressions` to audit; target 0 unjustified items

## TypeScript Strict Rules

- TypeScript `strict: true`, no `any` types
- Use `unknown` + type guards instead of `any`
- Validate with Zod at service boundaries
- Be explicit: `!== null`, `!== undefined` (no implicit boolean coercion)

## Refactoring Patterns

### Options Object Pattern (max-params fix)

```typescript
// ❌ BAD - 6 parameters
function process(a, b, c, d, e, f) { ... }

// ✅ GOOD - Options object
interface ProcessOptions { a: A; b: B; c: C; d: D; e: E; f: F; }
function process(opts: ProcessOptions) { ... }
```

### Data-Driven Approach (complexity fix)

```typescript
// ❌ BAD - High complexity from repeated if/else
if (a) { ... } if (b) { ... } if (c) { ... }

// ✅ GOOD - Data-driven, complexity stays at 2
const FIELDS = [{ key: 'a' }, { key: 'b' }, { key: 'c' }] as const;
FIELDS.map(({ key }) => /* handle */);
```

### Early Return Pattern (max-depth fix)

```typescript
// ❌ BAD - Deep nesting
if (data) {
  if (data.isValid) {
    if (data.items.length > 0) {
      /* logic */
    }
  }
}

// ✅ GOOD - Early returns, flat
if (!data) return defaultResult;
if (!data.isValid) return invalidResult;
if (data.items.length === 0) return emptyResult;
// actual logic at depth 1
```

## Pino Logger Format

```typescript
// ✅ CORRECT - Error object in first argument
logger.error({ err: error }, 'Failed to process request');
logger.info({ requestId, duration }, 'Request completed');

// ❌ WRONG - Will fail lint
logger.error(error, 'Failed to process');
```

## Testing Standards

### Core Principles

1. Test behavior, not implementation
2. Colocated tests - `MyService.test.ts` next to `MyService.ts`
3. **When extracting code to a new file, extract/create the `.test.ts` file too** - Do NOT add `structure.test.ts` exclusions for modules with logic
4. Mock all external dependencies - Discord, Redis, Prisma, AI
5. Use fake timers - No real delays in tests

### Fake Timers (ALWAYS Use)

```typescript
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
});

// Promise rejections with fake timers (CRITICAL)
const promise = asyncFunction();
const assertion = expect(promise).rejects.toThrow('Error'); // Attach handler FIRST
await vi.runAllTimersAsync(); // Then advance
await assertion;
```

### When to Add Tests

| Change             | Unit | Schema      | Integration                  |
| ------------------ | ---- | ----------- | ---------------------------- |
| New API endpoint   | ✅   | ✅ Required | ✅ If DB/multi-service       |
| New `*.service.ts` | ✅   | If shared   | ✅ For complex DB operations |
| Bug fix            | ✅   | If schema   | If multi-component           |

### Integration Tests (`pnpm test:int`)

Integration tests (`*.int.test.ts`) run separately from unit tests and are **not** included in `pnpm test` or pre-push hooks.

**Always run `pnpm test:int` after:**

| Change                           | Why                                                                   |
| -------------------------------- | --------------------------------------------------------------------- |
| Add/remove slash command options | `CommandHandler.int.test.ts` snapshots capture full command structure |
| Add/remove subcommands           | Same snapshot tests                                                   |
| Restructure command directories  | `getCommandFiles()` discovery changes affect command loading          |
| Change component prefix routing  | Integration tests verify button/select menu routing                   |

**Update snapshots with:** `pnpm vitest run --config vitest.int.config.ts <file> --update`

### Schema Test Colocation

Schema tests follow the same colocation rule as all other tests:

- `schemas/api/persona.ts` → `schemas/api/persona.test.ts`
- `types/jobs.ts` → `types/jobs.test.ts`

Do NOT place schema tests in a separate directory.

## Types & Constants

### When to Add to Common-Types

| Content                | Add to Common-Types? | Location                |
| ---------------------- | -------------------- | ----------------------- |
| Value used in 2+ files | ✅ Yes               | `constants/<domain>.ts` |
| BullMQ job payloads    | ✅ Yes               | `types/queue-types.ts`  |
| HTTP API contracts     | ✅ Yes               | `types/schemas.ts`      |
| Service-internal types | ❌ No                | Keep in service         |

### Constant Naming

```typescript
export const MY_CONFIG = {
  /** Description */
  VALUE: 123,
} as const; // Always use 'as const'
```

## Module Organization

**Import from source modules, not index files.** Re-exports create circular import issues.

```typescript
// ✅ GOOD - Import from source
import { formatDate } from './utils/dateUtils.js';

// ❌ BAD - Re-exporting for convenience
import { formatDate } from './utils/index.js';
```

**Exception**: Package entry points (e.g., `@tzurot/common-types`) are acceptable.
