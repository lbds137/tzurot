---
name: tzurot-testing
description: Comprehensive testing patterns for Tzurot v3 - Vitest configuration, fake timers, promise handling, mocking strategies, and test organization. Use this when writing or modifying tests.
lastUpdated: '2025-11-19'
---

# Tzurot v3 Testing Patterns

**Use this skill when:** Writing tests, debugging test failures, or adding test coverage to Tzurot v3 codebase.

## Core Principles

1. **Test behavior, not implementation** - Focus on WHAT code does, not HOW
2. **Test public APIs only** - Never test private methods or internal state
3. **Mock all external dependencies** - Discord.js, Redis, database, AI providers
4. **Use fake timers** - Never use real timeouts or delays in tests
5. **Colocated tests** - Test files live next to source files (e.g., `MyService.test.ts` next to `MyService.ts`)

## Test File Organization

### Standard Structure (Colocated)

```
src/
├── services/
│   ├── MyService.ts
│   ├── MyService.test.ts        # ← Test next to source
│   ├── AnotherService.ts
│   └── AnotherService.test.ts
└── utils/
    ├── helper.ts
    └── helper.test.ts
```

**Exception:** Integration tests that span multiple modules can live in `src/test/` directories.

### Build Configuration

Ensure `tsconfig.json` excludes test files:

```json
{
  "exclude": ["node_modules", "**/*.test.ts", "**/*.spec.ts"]
}
```

## Vitest Patterns

### Basic Test Structure

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('MyService', () => {
  let service: MyService;
  let mockDependency: MockedDependency;

  beforeEach(() => {
    // Setup mocks
    mockDependency = createMockDependency();
    service = new MyService(mockDependency);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('methodName', () => {
    it('should do the expected behavior', () => {
      // Arrange
      const input = {
        /* test data */
      };

      // Act
      const result = service.methodName(input);

      // Assert
      expect(result).toEqual(expectedOutput);
    });
  });
});
```

## Fake Timers

### Always Use Fake Timers for Time-Based Code

```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('time-based operations', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should retry with exponential backoff', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('Fail 1'))
      .mockRejectedValueOnce(new Error('Fail 2'))
      .mockResolvedValueOnce('success');

    // Start the async operation
    const promise = withRetry(fn, { maxAttempts: 3, initialDelayMs: 100 });

    // Advance timers to trigger retries
    await vi.runAllTimersAsync();

    // Await the result
    const result = await promise;
    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
```

## Promise Rejection Handling with Fake Timers

**CRITICAL PATTERN:** When testing code that rejects promises after timer delays, attach assertion handlers BEFORE advancing timers to avoid unhandled rejection warnings.

### The Problem

```typescript
// ❌ WRONG - Causes PromiseRejectionHandledWarning
it('should throw error after timeout', async () => {
  const promise = asyncFunction();

  await vi.runAllTimersAsync(); // ❌ Rejection happens here, no handler attached yet

  await expect(promise).rejects.toThrow(); // ❌ Handler attached too late
});
```

**Why it fails:** Race condition between timer advancement and handler attachment:

1. `const promise = asyncFunction()` - Creates promise (no handler)
2. `await vi.runAllTimersAsync()` - Advances timers, triggers rejection
3. Promise rejects with NO handler → Warning issued
4. `await expect(promise).rejects...` - Handler attached too late

### The Solution

```typescript
// ✅ CORRECT - Attach handler BEFORE advancing timers
it('should throw error after timeout', async () => {
  const error = new Error('Timeout');
  const fn = vi.fn().mockRejectedValue(error);

  // 1. Create the promise
  const promise = withRetry(fn, { maxAttempts: 3, initialDelayMs: 100 });

  // 2. Attach handler BEFORE advancing timers
  const assertionPromise = expect(promise).rejects.toThrow('Timeout');

  // 3. NOW advance the timers
  await vi.runAllTimersAsync();

  // 4. Await the assertion
  await assertionPromise;

  // 5. Additional assertions
  expect(fn).toHaveBeenCalledTimes(3);
});
```

### Alternative Pattern (Inspecting Error Details)

```typescript
it('should throw with details', async () => {
  expect.assertions(2);

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

## Mocking Patterns

### Discord.js Mocking

```typescript
import type { Message, TextChannel, Guild } from 'discord.js';

function createMockMessage(overrides?: Partial<Message>): Message {
  return {
    id: '123456789',
    content: 'test message',
    author: {
      id: 'user-123',
      username: 'testuser',
      bot: false,
    },
    channel: {
      id: 'channel-123',
      type: 0, // Text channel
      send: vi.fn().mockResolvedValue({}),
    },
    guild: {
      id: 'guild-123',
    },
    reply: vi.fn().mockResolvedValue({}),
    ...overrides,
  } as unknown as Message;
}
```

### BullMQ Mocking

```typescript
import type { Queue, Job } from 'bullmq';

function createMockQueue(): Queue {
  return {
    add: vi.fn().mockResolvedValue({ id: 'job-123' }),
    getJob: vi.fn().mockResolvedValue(null),
    pause: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
  } as unknown as Queue;
}

function createMockJob(data: any): Job {
  return {
    id: 'job-123',
    data,
    progress: vi.fn(),
    updateProgress: vi.fn(),
    log: vi.fn(),
  } as unknown as Job;
}
```

### Redis Mocking

```typescript
import type { Redis } from 'ioredis';

function createMockRedis(): Redis {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    setEx: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
    ping: vi.fn().mockResolvedValue('PONG'),
    disconnect: vi.fn(),
    duplicate: vi.fn(),
    on: vi.fn(),
  } as unknown as Redis;
}
```

### Prisma Mocking

```typescript
import type { PrismaClient } from '@prisma/client';

function createMockPrisma(): PrismaClient {
  return {
    personality: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    conversationHistory: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    $disconnect: vi.fn().mockResolvedValue(undefined),
  } as unknown as PrismaClient;
}
```

### AI Provider Mocking (OpenRouter/Gemini)

```typescript
interface MockAIResponse {
  content: string;
  model: string;
  usage?: { tokens: number };
}

function createMockAIProvider() {
  return {
    generateResponse: vi.fn().mockResolvedValue({
      content: 'Mock AI response',
      model: 'test-model',
      usage: { tokens: 100 },
    } as MockAIResponse),
    generateEmbedding: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
  };
}
```

## Service Testing Patterns

### Constructor Injection Pattern

```typescript
describe('PersonalityService', () => {
  let service: PersonalityService;
  let mockPrisma: PrismaClient;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    service = new PersonalityService(mockPrisma);
  });

  it('should load personality from database', async () => {
    vi.mocked(mockPrisma.personality.findUnique).mockResolvedValue({
      id: 'test-id',
      name: 'TestPersonality',
      systemPrompt: 'Test prompt',
      // ... other fields
    });

    const personality = await service.getPersonality('test-id');

    expect(personality).toBeDefined();
    expect(personality?.name).toBe('TestPersonality');
    expect(mockPrisma.personality.findUnique).toHaveBeenCalledWith({
      where: { id: 'test-id' },
    });
  });
});
```

### Error Handling Tests

```typescript
describe('error handling', () => {
  it('should handle database connection errors', async () => {
    const dbError = new Error('Database connection failed');
    vi.mocked(mockPrisma.personality.findUnique).mockRejectedValue(dbError);

    await expect(service.getPersonality('test-id')).rejects.toThrow('Database connection failed');
  });

  it('should handle not found errors', async () => {
    vi.mocked(mockPrisma.personality.findUnique).mockResolvedValue(null);

    const personality = await service.getPersonality('nonexistent');

    expect(personality).toBeNull();
  });
});
```

## Snapshot Testing

**Use snapshots sparingly** - Only for complex output that's expensive to manually assert.

```typescript
describe('prompt generation', () => {
  it('should generate correct prompt structure', () => {
    const prompt = generatePrompt({
      personality: 'Lilith',
      context: 'Test context',
      history: [],
    });

    // Snapshot ensures prompt structure doesn't accidentally change
    expect(prompt).toMatchSnapshot();
  });
});
```

## Running Tests

### Command Reference

```bash
# Run all tests
pnpm test

# Run specific service tests
pnpm --filter @tzurot/ai-worker test

# Run specific test file
pnpm test -- MyService.test.ts

# Check test summary
pnpm test 2>&1 | grep -E "(Test Files|Tests)" | sed 's/\x1b\[[0-9;]*m//g'

# Watch mode (for development)
pnpm test -- --watch
```

### Before Pushing to Remote

**ALWAYS run tests before pushing!** Even "simple" changes can break tests.

```bash
# 1. Run all tests
pnpm test

# 2. Verify summary shows all passing
pnpm test 2>&1 | grep -E "(Test Files|Tests)" | sed 's/\x1b\[[0-9;]*m//g'

# 3. If all green, safe to push
git push origin <branch-name>
```

## Anti-Patterns to Avoid

### ❌ Don't Test Implementation Details

```typescript
// ❌ BAD - Testing private methods
expect(service['privateMethod']()).toBe(value);

// ✅ GOOD - Test public behavior
expect(service.publicMethod()).toBe(value);
```

### ❌ Don't Use Real Timeouts

```typescript
// ❌ BAD - Real delay in tests
await new Promise(resolve => setTimeout(resolve, 1000));

// ✅ GOOD - Fake timers
vi.useFakeTimers();
await vi.advanceTimersByTimeAsync(1000);
```

### ❌ Don't Mock What You Don't Own

```typescript
// ❌ BAD - Mocking Node.js built-ins directly
vi.mock('fs');

// ✅ GOOD - Wrap in your own abstraction and mock that
class FileSystem {
  readFile(path: string) {
    /* uses fs */
  }
}
```

### ❌ Don't Leave Console Logs in Tests

```typescript
// ❌ BAD - Debugging logs left in
it('should work', () => {
  console.log('Debug:', value); // Remove before commit
  expect(value).toBe(expected);
});
```

### ❌ Don't Skip Tests Instead of Fixing

```typescript
// ❌ BAD - Skipping broken tests
it.skip('should work', () => {
  /* ... */
});

// ✅ GOOD - Fix or remove the test
it('should work', () => {
  /* fixed implementation */
});
```

## Test Coverage Goals

- **Services:** Aim for >80% coverage
- **Utils:** Aim for >90% coverage (these are pure functions)
- **Types/Interfaces:** No coverage needed (TypeScript provides type safety)

## Related Skills

- **tzurot-constants** - Use named constants for test data and timeouts
- **tzurot-observability** - Add logging to debug failing tests
- **tzurot-shared-types** - Type-safe test fixtures and mocks
- **tzurot-git-workflow** - Always run tests before committing/pushing

## References

- Full testing guide: `docs/guides/TESTING.md`
- Global testing principles: `~/.claude/CLAUDE.md#universal-testing-philosophy`
- Project testing patterns: `CLAUDE.md#testing`
