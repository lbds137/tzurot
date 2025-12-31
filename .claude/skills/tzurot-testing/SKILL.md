---
name: tzurot-testing
description: Use when writing tests, debugging test failures, mocking dependencies, or using fake timers. Covers Vitest patterns, mock factories, and promise rejection handling.
lastUpdated: '2025-12-31'
---

# Tzurot v3 Testing Patterns

**Use this skill when:** Writing tests, debugging test failures, adding mocks, or working with fake timers.

## Quick Reference

```bash
# Run all tests
pnpm test

# Run specific service
pnpm --filter @tzurot/ai-worker test

# Run specific file
pnpm test -- MyService.test.ts

# Coverage
pnpm test:coverage
```

```typescript
// Basic test structure
import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('MyService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should do something', () => {
    expect(result).toBe(expected);
  });
});
```

## Core Principles

1. **Test behavior, not implementation**
2. **Colocated tests** - `MyService.test.ts` next to `MyService.ts`
3. **Mock all external dependencies** - Discord, Redis, Prisma, AI
4. **Use fake timers** - No real delays in tests

## Essential Patterns

### Fake Timers (ALWAYS Use)

```typescript
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.restoreAllMocks();
});

it('should retry with delay', async () => {
  const promise = withRetry(fn);
  await vi.runAllTimersAsync();
  await promise;
});
```

### Promise Rejections with Fake Timers (CRITICAL)

```typescript
// ❌ WRONG - Causes PromiseRejectionHandledWarning
const promise = asyncFunction();
await vi.runAllTimersAsync(); // Rejection happens here!
await expect(promise).rejects.toThrow(); // Too late

// ✅ CORRECT - Attach handler BEFORE advancing timers
const promise = asyncFunction();
const assertion = expect(promise).rejects.toThrow('Error'); // Handler attached
await vi.runAllTimersAsync(); // Now advance
await assertion; // Await result
```

### Mock Factory Pattern

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

### Common Mocks

```typescript
// Discord message
function createMockMessage(overrides = {}) {
  return {
    id: '123',
    content: 'test',
    author: { id: 'user-123', bot: false },
    channel: { id: 'channel-123', send: vi.fn() },
    reply: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as Message;
}

// Prisma
function createMockPrisma() {
  return {
    personality: { findUnique: vi.fn(), findMany: vi.fn() },
    $disconnect: vi.fn(),
  } as unknown as PrismaClient;
}

// Redis
function createMockRedis() {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    ping: vi.fn().mockResolvedValue('PONG'),
  } as unknown as Redis;
}
```

## Test File Naming

| Type        | Pattern               | Location              |
| ----------- | --------------------- | --------------------- |
| Unit        | `*.test.ts`           | Next to source        |
| Component   | `*.component.test.ts` | Next to source        |
| Integration | `*.test.ts`           | `tests/integration/`  |
| Contract    | `*.contract.test.ts`  | `common-types/types/` |

## Mock Reset Functions

| Function               | What It Does                    | When to Use    |
| ---------------------- | ------------------------------- | -------------- |
| `vi.clearAllMocks()`   | Clears call history, keeps impl | `beforeEach()` |
| `vi.restoreAllMocks()` | Restores original (spies only)  | `afterEach()`  |
| `vi.resetAllMocks()`   | Clears history + resets impl    | Rarely needed  |

## When to Add Tests

| Change           | Unit | Contract    | Integration    |
| ---------------- | ---- | ----------- | -------------- |
| New API endpoint | ✅   | ✅          | Consider       |
| New service      | ✅   | If shared   | Consider       |
| New utility      | ✅   | No          | No             |
| Bug fix          | ✅   | If contract | If integration |

## Contract Tests

Contract tests verify API boundaries between services. Located in `common-types/types/`.

```typescript
// *.contract.test.ts - Verify schema compatibility
import { PersonaResponseSchema } from './schemas.js';

describe('PersonaResponse contract', () => {
  it('should parse valid API response', () => {
    const response = { id: 'uuid', name: 'Test', preferredName: null };
    expect(() => PersonaResponseSchema.parse(response)).not.toThrow();
  });

  it('should reject invalid response', () => {
    const response = { id: 123 }; // Wrong type
    expect(() => PersonaResponseSchema.parse(response)).toThrow();
  });
});
```

**When to write**: New API endpoints, schema changes, cross-service communication.

**Purpose**: Catch breaking changes before they hit production. If bot-client expects `{ name: string }` but api-gateway returns `{ displayName: string }`, contract tests fail.

## Integration Tests

Integration tests verify multiple components working together. Located in `tests/integration/`.

```typescript
// Test actual service interactions (with mocked externals)
describe('AI generation flow', () => {
  it('should process job through full pipeline', async () => {
    // Setup: Create test job data
    const jobData = createTestGenerationJob();

    // Act: Process through actual handlers (mocking only AI/Discord)
    const result = await processGenerationJob(jobData);

    // Assert: Verify end-to-end behavior
    expect(result.response).toBeDefined();
    expect(mockDiscordWebhook).toHaveBeenCalled();
  });
});
```

**When to write**: Complex workflows, cross-service operations, database interactions.

**Key difference**:
- **Unit tests**: Mock all dependencies, test one function
- **Integration tests**: Use real components (except external APIs like Discord, OpenRouter)

## Anti-Patterns

```typescript
// ❌ BAD - Testing private methods
expect(service['privateMethod']()).toBe(value);

// ❌ BAD - Real delays
await new Promise(r => setTimeout(r, 1000));

// ❌ BAD - console.log in tests
console.log('Debug:', value);

// ❌ BAD - Skipping instead of fixing
it.skip('broken test', () => {});
```

## Coverage Requirements (CI Enforced)

```bash
# Check coverage locally
pnpm test:coverage

# Specific service
pnpm --filter @tzurot/api-gateway test:coverage
```

| Target | Threshold | Enforcement |
|--------|-----------|-------------|
| Project | 80% | Codecov blocks if drops >2% |
| Patch | 80% | New code must be 80%+ covered |
| Services | 80% | Tracked per-service (ai-worker, api-gateway, bot-client) |
| Utils | 90% | Higher bar for shared utilities |

**CI Gate**: Codecov runs on every PR. Coverage report shows:
- Overall project coverage change
- Per-file coverage for changed files
- Patch coverage (new/modified lines only)

## Related Skills

- **tzurot-code-quality** - Lint rules, refactoring patterns
- **tzurot-types** - Type-safe test fixtures
- **tzurot-git-workflow** - Run tests before pushing
- **tzurot-observability** - Mock logger in tests

## References

- Full testing guide: `docs/guides/TESTING.md`
- Mock factories: `services/*/src/test/mocks/`
- Global philosophy: `~/.claude/CLAUDE.md#universal-testing-philosophy`
