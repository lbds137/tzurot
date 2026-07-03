---
name: tzurot-testing
description: 'Testing procedures. Invoke with /tzurot-testing for test execution, coverage audits, and debugging test failures.'
lastUpdated: '2026-07-03'
---

# Testing Procedures

**Invoke with /tzurot-testing** for test-related procedures.

**Testing patterns are in `.claude/rules/02-code-standards.md`** - they apply automatically.

## Running Tests

```bash
# Run all tests
pnpm test

# Run specific service
pnpm --filter @tzurot/ai-worker test

# Run specific file
pnpm test -- MyService.test.ts

# Run the component tier (PGLite) — NOT included in `pnpm test`
pnpm test:component

# Run the integration + contract tiers (real Redis/Postgres) — NOT in `pnpm test`
pnpm test:integration

# Run with coverage
pnpm test:coverage

# Run only changed packages
pnpm focus:test
```

## Coverage Audit Procedure

```bash
# Run unified audit (CI does this automatically)
pnpm ops test:audit

# Filter by category
pnpm ops test:audit --category=services
pnpm ops test:audit --category=contracts

# Update baseline (after closing gaps)
pnpm ops test:audit --update

# Strict mode (fails on ANY gap)
pnpm ops test:audit --strict
```

**Unified Baseline**: `test-coverage-baseline.json` (project root)

## Test File Types

Tiers are canonically defined in **one place** —
[Test Tier Taxonomy](../../../docs/reference/guides/TESTING.md#test-tier-taxonomy).
This table is the suffix→tier quick reference; don't re-define the tiers here
(the `pnpm ops guard:test-taxonomy` gate enforces the single-source link).

| Suffix / location       | Tier ([taxonomy](../../../docs/reference/guides/TESTING.md#test-tier-taxonomy)) | Infrastructure | Location               |
| ----------------------- | ------------------------------------------------------------------------------- | -------------- | ---------------------- |
| `*.test.ts`             | Unit                                                                            | Fully mocked   | Next to source         |
| `*.component.test.ts`   | **Component** (one service, PGLite)                                             | PGLite         | Next to source         |
| `*.integration.test.ts` | **Integration** (real DB+Redis)                                                 | Real services  | `tests/e2e/`           |
| `*.contract.test.ts`    | **Contract** (provider↔consumer)                                                | Real services  | `tests/e2e/contracts/` |

> Each suffix names its tier directly. **Schema test ≠ contract test**: a Zod
> schema test (a plain `*.test.ts`) validates one type's own rules (unit-tier); a
> contract test verifies two services agree. Run `pnpm ops test:tiers` for the
> per-package tier distribution.

### Verify with the config that runs the tier (CRITICAL)

**The unit `pnpm test` config EXCLUDES the `.component` / `.integration` /
`.contract` suffixes.** A contract/integration/component test "passes" under
`pnpm test` by NOT running at all — so a green unit run is NOT evidence it works.

| Suffix                                         | Verify with             |
| ---------------------------------------------- | ----------------------- |
| `*.test.ts` (unit)                             | `pnpm test`             |
| `*.component.test.ts`                          | `pnpm test:component`   |
| `*.integration.test.ts` / `*.contract.test.ts` | `pnpm test:integration` |

When you touch a `.contract` / `.integration` test, run `pnpm test:integration`
(Redis + Postgres up: `podman start tzurot-redis tzurot-postgres`); a
`.component` test, `pnpm test:component`. `pnpm test` / `pnpm --filter <pkg> test`
is the unit tier ONLY. CI's `component-tests` job runs `test:component` +
`test:integration`, so it catches what a unit-only local run silently skipped —
don't let CI be the first thing that actually executes your contract test.

Gotcha for mention/ID fixtures: tests need a **valid 17–19 digit Discord
snowflake** — `isValidDiscordId` silently drops toy ids like `555` before
resolution, making the assertion pass/fail for the wrong reason.

## Debugging Test Failures

### 1. Run Specific Test

```bash
pnpm test -- MyService.test.ts --reporter=verbose
```

### 2. Check for Fake Timer Issues

```typescript
// ❌ WRONG - Promise rejection warning
const promise = asyncFunction();
await vi.runAllTimersAsync(); // Rejection happens here!
await expect(promise).rejects.toThrow(); // Too late

// ✅ CORRECT - Attach handler BEFORE advancing
const promise = asyncFunction();
const assertion = expect(promise).rejects.toThrow('Error');
await vi.runAllTimersAsync();
await assertion;
```

### 3. Reset Mock State

```typescript
beforeEach(() => {
  vi.clearAllMocks(); // Clear call history, keep impl
});
afterEach(() => {
  vi.restoreAllMocks(); // Restore originals (spies only)
});
```

## Creating Mock Factories

```typescript
// Use async factory for vi.mock hoisting
vi.mock('./MyService.js', async () => {
  const { mockMyService } = await import('../test/mocks/MyService.mock.js');
  return mockMyService;
});

// Import accessors after vi.mock
import { getMyServiceMock } from '../test/mocks/index.js';

it('should call service', () => {
  expect(getMyServiceMock().someMethod).toHaveBeenCalled();
});
```

## Integration Tests with PGLite

```typescript
describe('UserService', () => {
  let pglite: PGlite;
  let prisma: PrismaClient;

  beforeAll(async () => {
    pglite = new PGlite({ extensions: { vector, citext } });
    await pglite.exec(loadPGliteSchema());
    prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
  });

  it('should create user', async () => {
    const service = new UserService(prisma);
    const userId = await service.getOrCreateUser('123', 'testuser');
    expect(userId).toBeDefined();
  });
});
```

**⚠️ ALWAYS use `loadPGliteSchema()`** - NEVER create tables manually!

## Component Test Triggers

Component tests (`*.component.test.ts`) run separately from unit tests and are **not** included in `pnpm test` or pre-push hooks.

**Always run `pnpm test:component` after:**

| Change                           | Why                                                                         |
| -------------------------------- | --------------------------------------------------------------------------- |
| Add/remove slash command options | `CommandHandler.component.test.ts` snapshots capture full command structure |
| Add/remove subcommands           | Same snapshot tests                                                         |
| Restructure command directories  | `getCommandFiles()` discovery changes affect command loading                |
| Change component prefix routing  | Component tests verify button/select menu routing                           |

**Update snapshots with:** `pnpm vitest run --config vitest.component.config.ts <file> --update`

## Human-Verification Requests (manual testing by the user)

The user is the ONLY manual-QA executor — usually on a phone, across session
crashes and compactions. Every request for manual verification MUST be a
complete, self-contained instruction with all five parts:

1. **Exact repro path** — including the axis that keeps getting asked back:
   regular message/reply vs **extended context**, which channel type, DM vs
   guild, which command variant. If the axis matters, say which; if it doesn't,
   say "either."
2. **The invariant under test** — what property is being verified, so an
   equivalent action counts ("any persona without an override," not "use
   persona X"). The user shouldn't have to ask "does that not count?"
3. **Masking state** — what cached/DB state could make the test falsely pass
   (e.g., an already-described image pulls from the DB and never exercises the
   new path). Name the reset step if one is needed.
4. **Expected observable** — exactly what the user should see if it works, and
   what failure looks like. Verify the expectation against the CODE
   (`buildModelFooterText`, not a persona's in-character explanation) before
   stating it.
5. **How to report** — screenshot, paste, or a simple pass/fail.

**Checklists are durable artifacts, not chat.** A release smoke-test checklist
is written into `CURRENT.md` (with per-item status), so it survives compaction
and the user can re-consult it from a phone. Track progress there as results
come in ("from my quick tests how much of the checklist did that get us?" must
be answerable from the file). Justify every case — a bloated matrix wastes the
user's time; each case states what it uniquely proves. After the user reports,
close the loop with runtime evidence (logs) when the user-visible outcome can't
prove the new code path ran.

## Definition of Done

- [ ] New service files have `.component.test.ts`
- [ ] New API schemas have a colocated `.test.ts` (unit-tier; no dedicated schema suffix)
- [ ] Coverage doesn't drop (Codecov enforces 80%)
- [ ] Run `pnpm ops test:audit` to verify no new gaps

## References

- Full testing guide: `docs/reference/guides/TESTING.md`
- Mock factories: `services/*/src/test/mocks/`
- PGLite setup: `docs/reference/testing/PGLITE_SETUP.md`
- Coverage audit: `docs/reference/testing/COVERAGE_AUDIT_SYSTEM.md`
- Rules: `.claude/rules/02-code-standards.md`
