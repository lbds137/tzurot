---
name: tzurot-testing
description: Comprehensive testing patterns for Tzurot v3 - Vitest configuration, fake timers, promise handling, mocking strategies, test organization, and coverage commands. Use this when writing or modifying tests.
lastUpdated: '2025-12-12'
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

**Exception:** Integration tests that span multiple modules live in `tests/integration/` directory.

### Test File Naming Conventions

Tzurot uses a **hybrid naming strategy** combining suffixes and directories:

**Colocated Tests (suffixes distinguish type):**

- **Unit Tests:** `*.test.ts`
  - All dependencies mocked (Prisma, Redis, Discord, AI providers)
  - Example: `PersonalityService.test.ts` with `createMockPrisma()`

- **Component Tests:** `*.component.test.ts`
  - Real in-memory database (PGlite) but mocked external services
  - Example: `AIJobProcessor.component.test.ts` with real PGlite + mocked OpenRouter

**Integration Tests (directory-based):**

- **Integration Tests:** `tests/integration/*.test.ts`
  - Real database, Redis, and external services (or mocked in CI)
  - Example: `tests/integration/AIRoutes.test.ts`

**Why This Matters:**

- **File name clarity:** `*.component.test.ts` immediately signals "real DB setup required"
- **CI/CD optimization:** Can run different test types at different pipeline stages
- **Cognitive load:** Developers know what's mocked vs real from the filename alone

**Example:**

```typescript
// Unit test - All mocked
// MyService.test.ts
const mockPrisma = createMockPrisma();
const service = new MyService(mockPrisma);

// Component test - Real DB, mocked external services
// MyService.component.test.ts
const pglite = new PGlite();
const prisma = new PrismaClient({ adapter: new PrismaPGlite(pglite) });
const service = new MyService(prisma); // Real DB!
const mockAI = createMockAIProvider(); // But AI is mocked

// Integration test - All real (or real in CI)
// tests/integration/MyService.test.ts
// Uses real Postgres, Redis from environment
```

### Build Configuration

Ensure `tsconfig.json` excludes all test files:

```json
{
  "exclude": [
    "node_modules",
    "**/*.test.ts",
    "**/*.component.test.ts",
    "**/*.integration.test.ts",
    "**/*.spec.ts"
  ]
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

## Mock Factory Pattern

**IMPORTANT:** For complex services with many dependencies, use the centralized mock factory pattern to reduce boilerplate and improve test maintainability.

### Directory Structure

```
services/<service>/src/test/mocks/
├── index.ts              # Re-exports all mocks
├── LLMInvoker.mock.ts    # Service mock + instance accessor
├── MemoryRetriever.mock.ts
├── PromptBuilder.mock.ts
├── utils.mock.ts         # Simple function mocks
└── fixtures/
    ├── index.ts          # Re-exports all fixtures
    ├── personality.ts    # createMockPersonality()
    └── context.ts        # createMockContext()
```

### Mock Factory Structure

Each mock factory exports:

1. **Mock module** - The object to pass to `vi.mock()`
2. **Instance accessor** - Function to get the mock instance for assertions
3. **Reset function** - Optional cleanup function

```typescript
// LLMInvoker.mock.ts
import { vi } from 'vitest';

export interface MockLLMInvokerInstance {
  getModel: ReturnType<typeof vi.fn>;
  invokeWithRetry: ReturnType<typeof vi.fn>;
}

let mockInstance: MockLLMInvokerInstance | null = null;

function createMockFunctions(): MockLLMInvokerInstance {
  return {
    getModel: vi.fn().mockReturnValue({
      model: { invoke: vi.fn().mockResolvedValue({ content: 'AI response' }) },
      modelName: 'test-model',
    }),
    invokeWithRetry: vi.fn().mockResolvedValue({ content: 'AI response' }),
  };
}

export const mockLLMInvoker = {
  LLMInvoker: class MockLLMInvoker {
    getModel: ReturnType<typeof vi.fn>;
    invokeWithRetry: ReturnType<typeof vi.fn>;

    constructor() {
      const fns = createMockFunctions();
      this.getModel = fns.getModel;
      this.invokeWithRetry = fns.invokeWithRetry;
      mockInstance = this;
    }
  },
};

export function getLLMInvokerMock(): MockLLMInvokerInstance {
  if (!mockInstance) throw new Error('Mock not instantiated');
  return mockInstance;
}

export function resetLLMInvokerMock(): void {
  mockInstance = null;
}
```

### Using Mock Factories with vi.mock()

**CRITICAL:** Because `vi.mock()` calls are hoisted before imports, you MUST use async factory functions with dynamic imports:

```typescript
// ❌ WRONG - Import happens after vi.mock is hoisted
import { mockLLMInvoker } from '../test/mocks/index.js';
vi.mock('./LLMInvoker.js', () => mockLLMInvoker); // Error!

// ✅ CORRECT - Async factory with dynamic import
vi.mock('./LLMInvoker.js', async () => {
  const { mockLLMInvoker } = await import('../test/mocks/LLMInvoker.mock.js');
  return mockLLMInvoker;
});

// Import accessors AFTER vi.mock declarations
import { getLLMInvokerMock, createMockPersonality } from '../test/mocks/index.js';
```

### Complete Test File Example

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MyService } from './MyService.js';

// Set up mocks using async factories
vi.mock('./LLMInvoker.js', async () => {
  const { mockLLMInvoker } = await import('../test/mocks/LLMInvoker.mock.js');
  return mockLLMInvoker;
});
vi.mock('./MemoryRetriever.js', async () => {
  const { mockMemoryRetriever } = await import('../test/mocks/MemoryRetriever.mock.js');
  return mockMemoryRetriever;
});

// Import accessors and fixtures after vi.mock
import {
  getLLMInvokerMock,
  getMemoryRetrieverMock,
  createMockPersonality,
  createMockContext,
} from '../test/mocks/index.js';

describe('MyService', () => {
  let service: MyService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new MyService(); // Instantiates mock dependencies
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call LLM with correct parameters', async () => {
    const personality = createMockPersonality({ model: 'claude-3' });
    const context = createMockContext();

    await service.generateResponse(personality, 'Hello', context);

    // Access mock instance for assertions
    expect(getLLMInvokerMock().invokeWithRetry).toHaveBeenCalled();
  });

  it('should handle memory retrieval', async () => {
    // Override default mock behavior for this test
    getMemoryRetrieverMock().retrieveRelevantMemories.mockResolvedValue([
      { pageContent: 'Memory 1', metadata: { id: 'm1' } },
    ]);

    const result = await service.generateResponse(
      createMockPersonality(),
      'Recall',
      createMockContext()
    );

    expect(result.retrievedMemories).toBe(1);
  });
});
```

### Available Mock Factories

**bot-client:** `services/bot-client/src/test/mocks/`

- `Discord.mock.ts` - Message, Channel, Guild, User factories
- `PersonalityService.mock.ts` - PersonalityService mock

**ai-worker:** `services/ai-worker/src/test/mocks/`

- `LLMInvoker.mock.ts` - LLM invocation
- `MemoryRetriever.mock.ts` - Memory retrieval
- `PromptBuilder.mock.ts` - Prompt construction
- `ContextWindowManager.mock.ts` - Token budgeting
- `LongTermMemoryService.mock.ts` - LTM storage
- `ReferencedMessageFormatter.mock.ts` - Reference formatting
- `utils.mock.ts` - Simple function mocks (processAttachments, etc.)
- `fixtures/` - Data factories (personality, context)

### When to Create New Mock Factories

1. **Same mock used in 2+ test files** - Extract to factory
2. **Mock has complex setup** - Centralize default configuration
3. **Mock needs instance tracking** - Use the factory pattern above
4. **Mock represents external service** - Create dedicated factory

### Mock Reset Strategies

Understanding when to use different reset functions is critical for test isolation:

| Function                    | What It Does                                                                            | When to Use                                                                          |
| --------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `vi.clearAllMocks()`        | Clears call history (`.mock.calls`, `.mock.results`) but **keeps mock implementations** | In `beforeEach()` to reset call counts between tests while preserving mock behavior  |
| `vi.resetAllMocks()`        | Clears call history AND **resets implementations to `undefined`**                       | When you need to completely reset mock behavior (rarely needed with factory pattern) |
| `vi.restoreAllMocks()`      | Restores original implementations (for `vi.spyOn` only)                                 | In `afterEach()` to clean up spies                                                   |
| `resetAllMocks()` (factory) | Sets instance references to `null`                                                      | When testing service instantiation errors or re-initialization                       |

**Recommended Pattern:**

```typescript
describe('MyService', () => {
  let service: MyService;

  beforeEach(() => {
    vi.clearAllMocks(); // Clear call history, keep mock implementations
    service = new MyService(); // Re-instantiate service (creates new mock instances)
  });

  afterEach(() => {
    vi.restoreAllMocks(); // Clean up any spies
  });

  // Tests...
});
```

**When to Use Factory Reset Functions:**

```typescript
import { resetAllMocks } from '../test/mocks/index.js';

// Only needed in specific scenarios:
it('should handle initialization failure', () => {
  resetAllMocks(); // Clear all instance references

  // Now getLLMInvokerMock() will throw "Mock not instantiated"
  expect(() => getLLMInvokerMock()).toThrow();
});
```

**Key Insight:** With the factory pattern, `vi.clearAllMocks()` + service re-instantiation is usually sufficient. The factory's `reset*Mock()` functions are for edge cases like testing initialization failures.

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

## Test Coverage

### Coverage Commands

```bash
# Run coverage for ALL services/packages
pnpm test:coverage

# Run coverage for a specific service
pnpm --filter @tzurot/api-gateway test:coverage
pnpm --filter @tzurot/bot-client test:coverage
pnpm --filter @tzurot/ai-worker test:coverage
pnpm --filter @tzurot/common-types test:coverage
```

### Coverage Configuration

- **Provider:** v8 (via `@vitest/coverage-v8`)
- **Config:** Root `vitest.config.ts` defines coverage settings
- **Reporters:** text (console), json, html, lcov
- **All mode:** `all: true` includes files even without tests

### Coverage Output

Each service generates its own coverage report in `<service>/coverage/`:

```
services/api-gateway/coverage/
├── coverage-final.json    # Programmatic access (used by CI)
├── index.html             # HTML report (open in browser)
├── lcov.info              # LCOV format (for CI tools like Codecov)
└── src/                   # Per-file HTML reports
```

**Important:** Coverage files are NOT committed (`.gitignore` excludes `coverage/`).

### Reading the Console Output

```
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-------------------|---------|----------|---------|---------|-------------------
All files          |   84.84 |    78.12 |   89.47 |   84.84 |
 src/services      |   91.60 |    81.57 |   94.59 |   91.47 |
  MyService.ts     |   95.65 |    80.76 |     100 |   95.49 | 42,249-250,277
-------------------|---------|----------|---------|---------|-------------------
```

- **% Stmts:** Statement coverage (primary metric)
- **% Branch:** Branch coverage (if/else paths)
- **% Funcs:** Function coverage
- **% Lines:** Line coverage
- **Uncovered Line #s:** Specific lines without coverage

### Coverage Targets

| File Type        | Target | Priority              |
| ---------------- | ------ | --------------------- |
| Services         | >80%   | High                  |
| Utils            | >90%   | High (pure functions) |
| Routes           | >70%   | Medium                |
| Types/Interfaces | N/A    | None needed           |

### Finding Coverage Gaps

```bash
# Run coverage and look for files < 70%
pnpm --filter @tzurot/api-gateway test:coverage 2>&1 | grep -E "^\s+\S+\.ts\s+\|\s+[0-6][0-9]\."
```

Files with <70% statement coverage should be prioritized for improvement.

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
