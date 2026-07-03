# Testing Guide

**Last Updated:** 2026-06-20
**Status:** Foundation complete; taxonomy reconciled to the Clemson 5-tier model

> **Purpose:** Guidelines and patterns for writing tests in Tzurot v3

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Test Tier Taxonomy](#test-tier-taxonomy)
3. [Test Infrastructure](#test-infrastructure)
4. [Writing Tests](#writing-tests)
5. [Mocking Dependencies](#mocking-dependencies)
6. [Running Tests](#running-tests)
7. [Memory Optimization](#memory-optimization)
8. [Examples](#examples)
9. [Common Patterns](#common-patterns)
10. [Troubleshooting](#troubleshooting)

---

## Philosophy

### Core Principles

**Test Behavior, Not Implementation**

- Focus on WHAT code does, not HOW it does it
- Test the public API only
- Don't test private methods or internal state
- If you need to test implementation details, extract them to a separate tested module

**Keep Tests Simple and Readable**

- Clear, descriptive test names
- One assertion per concept
- Arrange-Act-Assert pattern
- Comment WHY when the behavior is non-obvious

**Mock External Dependencies**

- Database calls → Mock PersonalityService, UserService, etc.
- API calls → Mock AI providers, Discord API
- Time-based code → Use fake timers
- File system → Mock file operations
- Never hit real external services in unit tests

**Fast and Isolated**

- Tests should run in milliseconds
- Each test is independent
- No shared state between tests
- Use `beforeEach` to reset mocks

---

## Test Tier Taxonomy

> **This section is the single source of truth for Tzurot's test tiers.** The
> always-loaded rule (`.claude/rules/02-code-standards.md`) and the testing
> skill (`/tzurot-testing`) link _here_ rather than re-defining the tiers —
> `pnpm ops guard:test-taxonomy` fails CI if either stops linking, or if this
> table drops a tier. Change a tier here AND in `CANONICAL_TEST_TIERS`
> (`packages/tooling/src/test/test-tiers.ts`); the guard keeps the two in sync.

Tzurot adopts Toby Clemson's microservice testing taxonomy ([martinfowler.com](https://martinfowler.com/articles/microservice-testing/)).
Five tiers, ordered most-isolated → most-integrated:

<!-- canonical-test-tiers:start -->

| Tier            | Scope                                                                                                                    | Real vs. stubbed                                                    | Our file convention                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Unit**        | one class / small group; business logic                                                                                  | all collaborators mocked (solitary) or real-but-observed (sociable) | `*.test.ts`                                                       |
| **Component**   | one whole service in isolation; its datastore is part of the unit                                                        | external _services_ stubbed; datastore real (PGLite)                | `*.component.test.ts`                                             |
| **Integration** | a module against ONE real external dependency; verifies the communication path (protocol, serialization, error handling) | the external dep is real (or a faithful double)                     | `*.integration.test.ts` (under `tests/e2e/`, real DB+Redis)       |
| **Contract**    | bilateral provider↔consumer agreement on a specific interface (consumer-driven)                                          | neither full service booted — just the contract                     | `*.contract.test.ts` (colocated, or under `tests/e2e/contracts/`) |
| **E2E**         | the system as a black box; full deployed ecosystem; user journeys                                                        | everything real                                                     | effectively none today                                            |

<!-- canonical-test-tiers:end -->

**Which tier suits which logic:** business/domain logic → **unit** (local, fast).
Cross-boundary / application logic → **contract** + **component** (local) and
**integration** against live deps. Don't over-mock cross-boundary logic — mocks
there are brittle and sacrifice the very encapsulation the test is meant to protect.

> **Suffix = tier.** Each suffix names its tier directly — `*.component.test.ts`,
> `*.integration.test.ts`, `*.contract.test.ts`, and plain `*.test.ts` for unit.
> Classification is a pure suffix check (no directory-location rule). Run
> `pnpm ops test:tiers` for the current per-package distribution.

### Schema tests are unit-tier, NOT contract tests

The word "contract" is overloaded — resolve it to two distinct things:

- **Schema test** — validates a single _type's own rules_ (which inputs a Zod
  schema accepts/rejects). Structurally a **unit** test of one type. It is NOT a
  cross-service contract. Conventionally colocated as plain `*.test.ts` next to
  the schema (e.g. `schemas/api/persona.ts` → `schemas/api/persona.test.ts`).
  There is no dedicated schema suffix — every schema test is a `*.test.ts` file
  counted in the unit tier.
- **Contract test** (the tier above) — verifies _two services agree_ on an
  interface (consumer-driven). The bot-client→ai-worker context envelope
  (golden-fixture) is the current real example. (The BullMQ producer/consumer
  pair under `tests/e2e/contracts/` currently validates payload _shape_ only — a
  schema check, not yet a true provider↔consumer contract.) Reserve the words
  "contract test" for this tier.

---

## Test Infrastructure

### Directory Structure

```
services/bot-client/
├── src/
│   ├── utils/
│   │   ├── personalityMentionParser.ts
│   │   └── personalityMentionParser.test.ts    ← Tests next to code
│   ├── handlers/
│   │   ├── MessageHandler.ts
│   │   └── MessageHandler.test.ts
│   └── test/
│       ├── setup.ts                             ← Global test setup
│       └── mocks/
│           ├── PersonalityService.mock.ts      ← Reusable mocks
│           ├── UserService.mock.ts
│           └── Discord.mock.ts
├── vitest.config.ts                             ← Service-specific config
└── package.json
```

### Configuration Files

**Root `/vitest.config.ts`:** Shared configuration for all services

- Fake timers enabled by default
- Coverage settings
- Test environment (Node.js)

**Service `/services/*/vitest.config.ts`:** Extends root config

- Service-specific test patterns
- Setup files
- Path aliases

### Available Tools

- **Vitest v4.0.3** - Test framework
- **Built-in mocking** - `vi.fn()`, `vi.mock()`
- **Fake timers** - `vi.useFakeTimers()`, `vi.advanceTimersByTime()`
- **Assertions** - `expect()` with matchers

---

## Writing Tests

### Test File Naming

Tzurot uses a **naming convention based on infrastructure needs**. Each suffix
maps directly to its [canonical tier](#test-tier-taxonomy):

| Extension               | Tier ([taxonomy](#test-tier-taxonomy)) | Infrastructure    | Location                              |
| ----------------------- | -------------------------------------- | ----------------- | ------------------------------------- |
| `*.test.ts`             | Unit                                   | Fully mocked      | Co-located with source                |
| `*.component.test.ts`   | **Component** (one service, PGLite)    | PGLite database   | Co-located with source                |
| `*.integration.test.ts` | **Integration** (real DB+Redis)        | Real services     | `tests/e2e/`                          |
| `*.contract.test.ts`    | **Contract** (provider↔consumer)       | PGLite / fixtures | Co-located, or `tests/e2e/contracts/` |

(A Zod schema test is just a unit test — a plain `*.test.ts`, not a distinct
suffix. See "Schema tests are unit-tier" above.)

**Examples:**

```
services/ai-worker/src/
├── jobs/
│   ├── AIJobProcessor.ts
│   ├── AIJobProcessor.test.ts     ← Unit test (all mocked)
│   └── AIJobProcessor.component.test.ts ← Component test (PGLite)
└── services/
    ├── PersonalityService.ts
    └── PersonalityService.test.ts ← Unit test (all mocked)

packages/common-types/src/types/
├── personality.schema.test.ts     ← schema validation (unit-tier; just a *.test.ts)

services/ai-worker/src/services/context/
└── RawEnvelopeContract.consumer.contract.test.ts ← Contract test, colocated with the code it locks

services/api-gateway/src/utils/
└── BullMQJobChainContract.producer.test.ts ← Producer fixture-writer (unit-tier; see note below)

tests/e2e/contracts/
└── BullMQJobChain.contract.test.ts ← Contract test reading a committed producer fixture (cross-service)
```

**Key Principles:**

- **Name by infrastructure**: If it needs PGLite → `.component.test.ts`
- **Co-locate by default**: Tests live next to the code they test
- **Centralize only cross-service**: `tests/e2e/` for multi-service flows

#### Golden-fixture contract tests (producer ↔ consumer)

A cross-service contract is verified with a committed JSON fixture, not a shared
import (the depcruise boundary forbids one service importing another). Two halves:

- **Producer fixture-writer** — a colocated `*.producer.test.ts` (e.g.
  `BullMQJobChainContract.producer.test.ts`) drives the **real** producer with
  mocked external deps and snapshots its output to `@tzurot/test-utils`
  (`stableFixtureJson` + `toMatchFileSnapshot(contractFixtureFile(...))`).
  **It runs at the unit tier** — despite "Contract" in the name it bears the plain
  `*.test.ts` suffix, because it only exercises the producer with mocks. (The
  tier-classifier keys on suffix; `*.producer.test.ts` is intentionally unit.)
- **Consumer contract test** — a `*.contract.test.ts` reads the SAME committed
  fixture and validates it against the consumer's entry schemas / real code.

**Regenerating a contract fixture** (when the producer's output legitimately
changes, CI fails the strict compare — regenerate on purpose and commit the diff):

```bash
# BullMQ job chain
pnpm --filter @tzurot/api-gateway exec vitest run BullMQJobChainContract.producer --update
# Raw assembly envelope
pnpm --filter @tzurot/bot-client exec vitest run RawEnvelopeContract.producer --update
```

The fixture directories under `packages/test-utils/fixtures/contracts/` are
`.prettierignore`d so the committed `stableFixtureJson` form is the source of truth.

### When to Use Each Test Type

Use this decision guide when creating new tests:

#### Unit Tests (`.test.ts`)

**Use when:**

- Testing pure functions and utilities
- Testing business logic with mocked dependencies
- Testing error handling paths
- Testing data transformations

**Characteristics:**

- All dependencies mocked (Prisma, Redis, Discord, AI)
- Fast execution (milliseconds)
- No network or database calls
- Should run offline

**Example scenarios:**

- Testing a message parser
- Testing validation logic
- Testing retry logic (with fake timers)
- Testing formatters and helpers

#### Component Tests (`.component.test.ts`)

> **Tier: component** (see [taxonomy](#test-tier-taxonomy)). These boot one whole
> service in isolation with its datastore (PGLite) as part of the unit; external
> _services_ stay stubbed. That's Clemson's "component," not "integration."

**Use when:**

- Testing code that writes to or reads from the database
- Testing queries, transactions, and constraints
- Testing service methods that interact with Prisma
- Verifying database schema compatibility

**Characteristics:**

- Uses PGLite (in-memory PostgreSQL via WASM)
- Tests real SQL queries and Prisma behavior
- Slower than unit tests (~1-5 seconds setup)
- Still mocks external APIs (Discord, AI)

**Example scenarios:**

- Testing UserService creates user with default persona
- Testing PersonalityService caching behavior
- Testing conversation history persistence
- Testing upsert/race condition handling

**Setup:**

```typescript
import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite/vector';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types';
import { loadPGliteSchema } from '@tzurot/test-utils';

let pglite: PGlite;
let prisma: PrismaClient;

beforeAll(async () => {
  pglite = new PGlite({ extensions: { vector, citext } });
  await pglite.exec(loadPGliteSchema());
  const adapter = new PrismaPGlite(pglite);
  prisma = new PrismaClient({ adapter }) as PrismaClient;
}, 30000);
```

#### Schema Tests (`.schema.test.ts`)

> **Tier: unit** (see [taxonomy](#test-tier-taxonomy)). A schema test validates a
> single _type's own rules_ — it is NOT a cross-service contract test. "Verifying
> a schema shape" (one type accepts/rejects inputs) ≠ "verifying a contract" (two
> services agree on an interface). Reserve [contract tests](#contract-tests)
> for the latter.

**Use when:**

- Testing Zod schema validation (which inputs a type accepts/rejects)
- Testing type guards
- Testing serialization/deserialization of a single type

**Characteristics:**

- Tests only Zod schemas - no database, no mocks
- Very fast execution
- Tests what shapes are valid/invalid
- Co-located with the schema it validates

**Example scenarios:**

- Testing PersonalityConfigSchema accepts valid config
- Testing API response schemas reject invalid data
- Testing job payload schemas

#### Contract Tests

> **Tier: contract** (see [taxonomy](#test-tier-taxonomy)). Colocated with the
> code it locks, or under `tests/e2e/contracts/` when there's no single home.
> Verifies that a producer and consumer _agree on a specific interface_
> (consumer-driven) — neither full service is booted, only the contract is exercised.

**Use when:**

- Two services exchange messages over a queue/HTTP boundary and you need to lock
  the shape they agree on (e.g. the BullMQ job producer ↔ consumer)
- A change to one side would silently break the other without a standing test

**Example scenarios:**

- Testing the BullMQ job producer/consumer contract
- Locking a `rawAssemblyInputs` envelope shape between bot-client and the worker

#### Integration & Contract Tests (`.integration.test.ts` / `.contract.test.ts`)

> **Tiers: integration + contract** (see [taxonomy](#test-tier-taxonomy)).
> `*.integration.test.ts` exercises a module against real external deps (Postgres,
> Redis) — Clemson's "integration" — under `tests/e2e/`. `*.contract.test.ts` locks
> a provider↔consumer agreement; it may be colocated with the code it locks or live
> under `tests/e2e/contracts/`. The suffix carries the tier (the `tests/e2e/`
> directory name is legacy). True black-box **E2E** is effectively none today.

> ⚠️ **Before adding a real-Postgres integration test:** the `component-integration-tests` CI
> job runs `pnpm test:integration` but provisions **only Redis** — there are no
> `*.integration.test.ts` files today (the tiers here use in-process PGLite or
> static fixtures). The first real-Postgres integration test will be picked up by
> the repo-wide glob and hit `ECONNREFUSED` in CI; add a Postgres service to the
> `component-integration-tests` job (or a dedicated integration job) at the same time. Tracked
> in [`backlog/cold/follow-ups.md`](../../../backlog/cold/follow-ups.md).

**Use when:**

- Testing the communication path to a real external dependency (protocol,
  serialization, error handling) — not just mocked behavior
- Testing database + Redis together

**Characteristics:**

- Integration tests use real services (Postgres, Redis); contract tests use
  PGLite / static fixtures (no live services)
- Integration tests live in `tests/e2e/`; contract tests may be colocated
- Slowest test type
- Run separately in CI (`pnpm test:integration`)

**Example scenarios:**

- Testing API gateway to worker flow against real infrastructure
- Testing database connectivity

### Decision Flowchart

```
Does it need real infrastructure (Postgres / Redis)?
├── NO → *.test.ts                                        (unit tier)
│        (a Zod schema test is just a unit test — no special suffix)
│
└── YES → Is it a provider↔consumer interface agreement?
          ├── YES → *.contract.test.ts (colocated, or tests/e2e/contracts/)  (contract tier)
          └── NO  → One whole service over PGLite, or real external deps?
                    ├── one service / PGLite → *.component.test.ts             (component tier)
                    └── real external deps   → tests/e2e/*.integration.test.ts (integration tier)
```

> Tier names follow the [Test Tier Taxonomy](#test-tier-taxonomy); each suffix
> names its tier directly.

### Test Structure

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { functionToTest } from './module.js';
import { createMockDependency } from '../test/mocks/Dependency.mock.js';

describe('Module Name', () => {
  let mockDependency: DependencyType;

  beforeEach(() => {
    // Fresh mocks before each test
    mockDependency = createMockDependency(/* config */);
  });

  describe('Feature Group', () => {
    it('should do X when Y happens', async () => {
      // Arrange: Set up test data
      const input = 'test input';

      // Act: Execute the code under test
      const result = await functionToTest(input, mockDependency);

      // Assert: Verify the behavior
      expect(result).toBe('expected output');
    });

    it('should handle edge case Z', async () => {
      const result = await functionToTest('', mockDependency);
      expect(result).toBeNull();
    });
  });
});
```

### Test Naming Conventions

**Good:**

- ✅ `should find single-word personality mention`
- ✅ `should return null when no personality is mentioned`
- ✅ `should prioritize multi-word over single-word personalities`

**Bad:**

- ❌ `test1`
- ❌ `it works`
- ❌ `findPersonalityMention returns Lilith`

**Pattern:** `should [expected behavior] when [condition]`

### What to Test

**✅ DO Test:**

- Public API functions
- Edge cases (empty strings, null, undefined)
- Error conditions
- Different input combinations
- Boundary conditions

**❌ DON'T Test:**

- Private methods
- Implementation details (regex patterns, loops)
- External library behavior
- Getters/setters with no logic

---

## Mocking Dependencies

### Creating Mock Services

**Pattern:** Factory function in `/test/mocks/`

```typescript
// src/test/mocks/PersonalityService.mock.ts
import { vi } from 'vitest';
import type { PersonalityService } from '@tzurot/common-types';

export function createMockPersonalityService(personalities: MockPersonality[]): PersonalityService {
  const personalityMap = new Map(personalities.map(p => [p.name.toLowerCase(), p]));

  return {
    loadPersonality: vi.fn(async (name: string) => {
      const personality = personalityMap.get(name.toLowerCase());
      return personality ? mockPersonalityObject(personality) : null;
    }),

    getAllPersonalities: vi.fn(async () => personalities as any[]),
  } as any;
}
```

**Usage in tests:**

```typescript
import { createMockPersonalityService } from '../test/mocks/PersonalityService.mock.js';

describe('My Feature', () => {
  let mockService: PersonalityService;

  beforeEach(() => {
    mockService = createMockPersonalityService([
      { name: 'Lilith', displayName: 'Lilith', systemPrompt: '...' },
      { name: 'Sarcastic', displayName: 'Sarcastic', systemPrompt: '...' },
    ]);
  });

  it('should use the mock service', async () => {
    const result = await myFunction(mockService);
    expect(result).toBeDefined();

    // Verify the mock was called
    expect(mockService.loadPersonality).toHaveBeenCalledWith('Lilith');
  });
});
```

### Verifying Mock Calls

```typescript
// Check if mock was called
expect(mockService.loadPersonality).toHaveBeenCalled();

// Check call count
expect(mockService.loadPersonality).toHaveBeenCalledTimes(2);

// Check arguments
expect(mockService.loadPersonality).toHaveBeenCalledWith('Lilith');

// Check call order
expect(mockService.loadPersonality).toHaveBeenNthCalledWith(1, 'First');
expect(mockService.loadPersonality).toHaveBeenNthCalledWith(2, 'Second');
```

### Using Fake Timers

```typescript
import { vi, beforeEach, afterEach } from 'vitest';

describe('Timer-based code', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should do something after delay', async () => {
    const callback = vi.fn();

    setTimeout(callback, 1000);

    // Fast-forward time
    vi.advanceTimersByTime(1000);

    expect(callback).toHaveBeenCalled();
  });
});
```

### Testing Promise Rejections with Fake Timers

**⚠️ Common Issue:** When testing code that rejects promises after timer delays (e.g., retry logic, timeouts), you may see `PromiseRejectionHandledWarning` even though tests pass.

**The Problem:** A race condition between timer advancement and handler attachment:

1. Create promise (no handler yet)
2. Advance timers → rejection occurs
3. Promise rejected with NO handler → warning
4. Handler attached too late

**✅ Solution:** Attach assertion handlers BEFORE advancing timers

```typescript
// ✅ CORRECT: Attach handler before advancing timers
it('should throw RetryError after all attempts fail', async () => {
  const fn = vi.fn().mockRejectedValue(new Error('Fail'));

  // 1. Create the promise
  const promise = withRetry(fn, { maxAttempts: 3, initialDelayMs: 100 });

  // 2. Attach handler BEFORE advancing timers
  const assertionPromise = expect(promise).rejects.toThrow(RetryError);

  // 3. NOW advance timers to trigger rejection
  await vi.runAllTimersAsync();

  // 4. Await the assertion
  await assertionPromise;

  // 5. Additional assertions
  expect(fn).toHaveBeenCalledTimes(3);
});

// ❌ INCORRECT: Handler attached too late (causes warnings)
it('should throw error', async () => {
  const promise = withRetry(fn, { maxAttempts: 3 });

  await vi.runAllTimersAsync(); // ❌ Rejection happens here

  // ❌ Handler attached after rejection
  await expect(promise).rejects.toThrow(RetryError);
});
```

**Alternative Pattern** (when you need to inspect the error):

```typescript
it('should throw with specific error details', async () => {
  expect.assertions(2);

  const fn = vi.fn().mockRejectedValue(new Error('Fail'));

  try {
    const promise = withRetry(fn, { maxAttempts: 3 });
    await vi.runAllTimersAsync();
    await promise;
  } catch (e: any) {
    expect(e).toBeInstanceOf(RetryError);
    expect(e.attempts).toBe(3);
  }
});
```

**Why This Works:** The `expect().rejects` matcher attaches the promise handler immediately when called, preventing the "unhandled rejection" state.

**Reference:** Gemini AI collaboration, PR #206 (2025-11-02)

### Fake Timers and Async Code Interaction

**⚠️ Critical Issue:** When using `vi.useFakeTimers()` with async/await, the `await` keyword yields control to the test runner's event loop, which can cause pending timers to fire unexpectedly.

**The Problem:** Code with `setTimeout` for AbortController timeouts can fail even when mocks resolve immediately:

```typescript
// Code being tested
async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    return response;
  } catch (error) {
    clearTimeout(timeout);
    throw error;
  }
}

// ❌ Test fails even though fetch mock resolves immediately
describe('with fake timers', () => {
  beforeEach(() => vi.useFakeTimers());

  it('should fetch successfully', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true });

    // The await gives fake timers a chance to run
    // The 30s timeout fires immediately, aborting the fetch!
    const result = await fetchWithTimeout('https://example.com');

    expect(result.ok).toBe(true); // ❌ Fails with AbortError
  });
});
```

**What Happens:**

1. `setTimeout` schedules the abort for 30,000ms (fake time)
2. `fetch` returns a resolved promise (mocked)
3. `await` yields control to the event loop
4. Vitest sees pending timer and runs it to prevent deadlock
5. `controller.abort()` fires before fetch promise completes
6. Test fails with `AbortError`

**✅ Solution 1:** Advance timers by 0ms to flush promise microtasks without triggering macrotasks

```typescript
it('should fetch successfully', async () => {
  global.fetch = vi.fn().mockResolvedValue({ ok: true });

  // Call but don't await yet
  const promise = fetchWithTimeout('https://example.com');

  // Advance by 0ms to let promises resolve without firing timers
  await vi.advanceTimersByTimeAsync(0);

  // Now await the result
  const result = await promise;

  expect(result.ok).toBe(true); // ✓ Passes
});
```

**✅ Solution 2:** Use real timers for tests not focused on timeout logic

```typescript
it('should fetch successfully', async () => {
  // Temporarily disable fake timers for this test
  vi.useRealTimers();

  global.fetch = vi.fn().mockResolvedValue({ ok: true });
  const result = await fetchWithTimeout('https://example.com');

  expect(result.ok).toBe(true); // ✓ Passes

  // Restore fake timers for other tests if needed
  vi.useFakeTimers();
});
```

**When to Use Each Solution:**

- **Solution 1:** When testing timeout logic is important
- **Solution 2:** When you only care about the happy path (recommended for simplicity)

**Testing the Timeout Path:** To verify timeout logic works, make the promise never resolve:

```typescript
it('should timeout and abort', async () => {
  // Mock that never resolves (simulates hang)
  global.fetch = vi.fn(() => new Promise(() => {}));

  const promise = fetchWithTimeout('https://example.com');

  // Advance past the timeout
  await vi.advanceTimersByTimeAsync(30000);

  await expect(promise).rejects.toThrow('AbortError');
});
```

**Key Insight:** `await` in tests with fake timers creates a checkpoint where Vitest can advance pending timers. Design tests accordingly.

**Reference:** Gemini AI collaboration during MultimodalProcessor test development (2025-11-15)

---

## Running Tests

### Commands

```bash
# Run all tests (from root)
pnpm test

# Run tests for specific service
cd services/bot-client
pnpm test

# Watch mode (re-run on file changes)
pnpm test --watch

# Coverage report
pnpm test --coverage

# Run specific test file
pnpm test personalityMentionParser.test.ts

# Run tests matching pattern
pnpm test --grep "Priority Rules"
```

### CI/CD Integration

Tests run automatically on:

- Pre-commit hooks (future)
- Pull request CI (future)
- Before deployments (future)

---

## Memory Optimization

When running the full test suite (5000+ tests), memory usage can spike significantly due to multiple Vitest processes and workers. This section documents strategies for reducing RAM consumption.

### Current Configuration

The base `vitest.config.ts` includes these memory-saving settings:

```typescript
// Vitest 4 top-level pool options (replaces poolOptions.threads)
pool: 'threads',
maxWorkers: 3,       // Limit workers (default uses all CPU cores)
minWorkers: 1,
mockReset: true,     // Clear mocks between tests
restoreMocks: true,  // Restore original implementations
```

### Available Commands

| Command             | Memory Usage | Speed  | Use Case                    |
| ------------------- | ------------ | ------ | --------------------------- |
| `pnpm test`         | Moderate     | Fast   | CI, machines with 16GB+ RAM |
| `pnpm test:low-mem` | Low          | Slower | Development on limited RAM  |

The `test:low-mem` command uses `--workspace-concurrency=1` to run one service at a time instead of all 4 in parallel.

### IDE Tips

- **Run full suite in external terminal** - The integrated terminal shares renderer memory with the IDE
- **Disable auto-watch for full suite** - Watch mode on 5000+ tests consumes significant resources
- **Run individual service tests during development** - `pnpm --filter @tzurot/bot-client test`

### Advanced Options (Not Currently Implemented)

If memory issues persist, consider these additional strategies:

#### 1. Vitest Workspaces (Single Process)

Instead of 4 separate Vitest processes, use a single root instance:

```typescript
// vitest.workspace.ts (in project root)
export default ['packages/*', 'services/*'];
```

Then run `vitest run` instead of pnpm filter. One process manages all tests, sharing the worker pool efficiently.

#### 2. Node.js Memory Flags

Set a hard memory limit to crash gracefully instead of freezing:

```bash
NODE_OPTIONS="--max-old-space-size=4096" pnpm test
```

Or add `--logHeapUsage` to Vitest to identify memory-heavy test files.

#### 3. Forks Pool (Better Isolation)

Switch from threads to forks for cleaner memory slate per test file:

```typescript
pool: 'forks',
poolOptions: {
  forks: {
    maxForks: 2,
    minForks: 1,
  },
},
```

Trade-off: Slower startup per file but better memory isolation.

#### 4. Heap Usage Logging

Identify which test files consume the most memory:

```typescript
test: {
  logHeapUsage: true,
}
```

### Reference

These recommendations were developed with MCP council consultation (Gemini) analyzing:

- 8-core CPU with 14GB RAM (Steam Deck)
- 4 pnpm workspace packages running in parallel
- Heavy mocking throughout tests (500MB-1GB per worker)

---

## Examples

See [personalityMentionParser.test.ts](../../services/bot-client/src/utils/personalityMentionParser.test.ts) for a complete example demonstrating:

- Mocking dependencies
- Testing behavior vs implementation
- Edge case handling
- Clear test organization

---

## Best Practices

### ✅ DO

- Write tests as you develop features
- Keep tests focused and independent
- Use descriptive test names
- Test edge cases and error conditions
- Mock all external dependencies
- Run tests before committing
- Fix flaky tests immediately

### ❌ DON'T

- Test implementation details
- Share state between tests
- Use real database/API calls
- Rely on test execution order
- Skip tests (fix or delete them)
- Test library code
- Write tests for trivial code

---

## Coverage Goals

**Current Status:**

- ✅ `personalityMentionParser` - 100% coverage (example)
- ⏳ Core utilities - Expanding
- 🚧 Services - Future
- 🚧 Integration tests - Future

**Priorities:**

1. Critical path code (mention parsing, message handling)
2. Business logic (personality loading, memory retrieval)
3. Utilities (formatters, validators)
4. Less critical: Simple getters, type guards

**Target:** 70%+ coverage on critical paths, not 100% on everything

---

## Next Steps

1. **Add more utility tests** - Format helpers, validators
2. **Service layer tests** - PersonalityService, UserService
3. **Integration tests** - Full message flow
4. **E2E tests** - Discord → AI response (future)

---

## Resources

- [Vitest Documentation](https://vitest.dev/)
- [Testing Best Practices](https://testingjavascript.com/)
- [Example: personalityMentionParser.test.ts](../../services/bot-client/src/utils/personalityMentionParser.test.ts)
