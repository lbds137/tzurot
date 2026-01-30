# Testing Guide

**Last Updated:** 2026-01-30
**Status:** Foundation complete, expanding coverage

> **Purpose:** Guidelines and patterns for writing tests in Tzurot v3

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Test Infrastructure](#test-infrastructure)
3. [Writing Tests](#writing-tests)
4. [Mocking Dependencies](#mocking-dependencies)
5. [Running Tests](#running-tests)
6. [Memory Optimization](#memory-optimization)
7. [Examples](#examples)
8. [Common Patterns](#common-patterns)
9. [Troubleshooting](#troubleshooting)

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

Tzurot uses a **naming convention based on infrastructure needs**:

| Extension          | Purpose             | Infrastructure  | Location               |
| ------------------ | ------------------- | --------------- | ---------------------- |
| `*.test.ts`        | Unit tests          | Fully mocked    | Co-located with source |
| `*.int.test.ts`    | Integration tests   | PGLite database | Co-located with source |
| `*.schema.test.ts` | Schema validation   | Zod only        | `common-types/`        |
| `*.e2e.test.ts`    | Cross-service flows | Real services   | `tests/e2e/`           |

**Examples:**

```
services/ai-worker/src/
├── jobs/
│   ├── AIJobProcessor.ts
│   ├── AIJobProcessor.test.ts     ← Unit test (all mocked)
│   └── AIJobProcessor.int.test.ts ← Integration test (PGLite)
└── services/
    ├── PersonalityService.ts
    └── PersonalityService.test.ts ← Unit test (all mocked)

packages/common-types/src/types/
├── personality.schema.test.ts     ← Schema test (Zod only)

tests/e2e/
├── database.e2e.test.ts           ← E2E test (real DB+Redis)
└── contracts/
    └── BullMQJobConsumer.e2e.test.ts ← Cross-service contract test
```

**Key Principles:**

- **Name by infrastructure**: If it needs PGLite → `.int.test.ts`
- **Co-locate by default**: Tests live next to the code they test
- **Centralize only cross-service**: `tests/e2e/` for multi-service flows

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

#### Integration Tests (`.int.test.ts`)

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
import { PrismaPGlite } from 'pglite-prisma-adapter';
import { PrismaClient } from '@tzurot/common-types';
import { loadPGliteSchema } from '@tzurot/test-utils';

let pglite: PGlite;
let prisma: PrismaClient;

beforeAll(async () => {
  pglite = new PGlite({ extensions: { vector } });
  await pglite.exec(loadPGliteSchema());
  const adapter = new PrismaPGlite(pglite);
  prisma = new PrismaClient({ adapter }) as PrismaClient;
}, 30000);
```

#### Schema Tests (`.schema.test.ts`)

**Use when:**

- Testing Zod schema validation
- Verifying API contract shapes
- Testing type guards
- Testing serialization/deserialization

**Characteristics:**

- Tests only Zod schemas - no database, no mocks
- Very fast execution
- Tests what shapes are valid/invalid
- Located in `common-types/`

**Example scenarios:**

- Testing PersonalityConfigSchema accepts valid config
- Testing API response schemas reject invalid data
- Testing job payload schemas

#### E2E Tests (`.e2e.test.ts`)

**Use when:**

- Testing cross-service communication
- Testing the full request/response flow
- Testing infrastructure contracts (BullMQ producer/consumer)
- Testing database + Redis together

**Characteristics:**

- Uses real services (Postgres, Redis)
- Lives in `tests/e2e/` directory
- Slowest test type
- Run separately in CI

**Example scenarios:**

- Testing BullMQ job producer/consumer contract
- Testing API gateway to worker flow
- Testing database connectivity

### Decision Flowchart

```
Does it need a real database?
├── NO → Does it test a Zod schema?
│        ├── YES → .schema.test.ts
│        └── NO  → .test.ts (unit test)
│
└── YES → Does it cross service boundaries?
          ├── YES → .e2e.test.ts
          └── NO  → .int.test.ts
```

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
