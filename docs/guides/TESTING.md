# Testing Guide

**Last Updated:** 2025-11-02
**Status:** Foundation complete, expanding coverage

> **Purpose:** Guidelines and patterns for writing tests in Tzurot v3

---

## Table of Contents

1. [Philosophy](#philosophy)
2. [Test Infrastructure](#test-infrastructure)
3. [Writing Tests](#writing-tests)
4. [Mocking Dependencies](#mocking-dependencies)
5. [Running Tests](#running-tests)
6. [Examples](#examples)
7. [Common Patterns](#common-patterns)
8. [Troubleshooting](#troubleshooting)

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

- **Unit tests:** `*.test.ts` (next to source file)
- **Integration tests:** `*.integration.test.ts` (future)

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
