# Testing Lessons Learned: V2 → V3 Migration

**Last Updated:** 2025-11-02
**Status:** Active guidance for v3 testing development

> **Purpose:** Document what worked well in v2's testing architecture, what didn't, and how v3 improves upon it.

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [V2 Testing Architecture](#v2-testing-architecture)
3. [What Worked Well](#what-worked-well)
4. [What Didn't Work](#what-didnt-work)
5. [V3 Testing Architecture](#v3-testing-architecture)
6. [Key Improvements](#key-improvements)
7. [Architectural Decisions](#architectural-decisions)
8. [Lessons Applied](#lessons-applied)

---

## Executive Summary

**V2 Testing Stack:** Jest + JavaScript + Extensive Mocking
**V3 Testing Stack:** Vitest + TypeScript + Type-Safe Mocks

**Critical Insight from Gemini Review:** V2's testing approach was solid but overly complex. V3 simplifies while adding type safety and better architecture.

---

## V2 Testing Architecture

### Test Structure

```
tzurot-legacy/
├── tests/
│   ├── __mocks__/         # Consolidated mock system
│   │   ├── index.js       # Presets
│   │   ├── discord.js     # Discord.js mocks
│   │   ├── api.js         # API mocks
│   │   ├── modules.js     # Internal module mocks
│   │   └── README.md
│   ├── unit/              # Unit tests
│   ├── setup.js           # Global test setup
│   └── helpers/           # Test utilities
```

### Key Patterns from V2

#### 1. Consolidated Mock System

V2 created a unified mock system to avoid duplication:

```javascript
// V2 Pattern: Mock Presets
const { presets } = require('../../__mocks__');

beforeEach(() => {
  mockEnv = presets.commandTest({
    userPermissions: ['ADMINISTRATOR'],
    discord: { nsfw: false },
  });
});
```

#### 2. Global Mock Setup

```javascript
// V2: tests/setup.js
jest.mock('../src/application/bootstrap/ApplicationBootstrap', () => ({
  ApplicationBootstrap: jest.fn().mockImplementation(() => ({
    initialize: jest.fn().mockResolvedValue(undefined),
  })),
}));
```

#### 3. Strict Timer Enforcement

V2 had strict ESLint rules and scripts to enforce injectable timers:

- `scripts/check-timer-patterns.js`
- Pre-commit hooks
- No real timers allowed in tests

#### 4. Performance Requirements

- Test suite must run in < 30 seconds
- Individual test files < 5 seconds
- Always use fake timers

---

## What Worked Well

### ✅ 1. Consolidated Mock System

**Benefit:** Avoided duplication across 100+ test files
**Evidence:** V2 had a clear, reusable mock API

```javascript
// Good: Single source of truth
const mockEnv = presets.commandTest();
const message = mockEnv.discord.createMessage();
```

**Lesson for V3:** Create reusable mock factories, not presets.

### ✅ 2. Strict Timer Discipline

**Benefit:** Prevented slow, flaky tests
**Evidence:** V2's test suite ran in ~14 seconds for hundreds of tests

**Lesson for V3:** Use Vitest's built-in fake timers, enforce via config.

### ✅ 3. Test-Driven Anti-Patterns Detection

**Benefit:** Caught common mistakes automatically
**Evidence:** Pre-commit hooks + CI/CD checks

Scripts that enforced quality:

- `check-timer-patterns.js` - No real timers
- `check-test-mock-patterns.js` - Proper mock usage
- `check-singleton-exports.js` - No singletons

**Lesson for V3:** Create similar Vitest-compatible checks.

### ✅ 4. Behavior Testing Philosophy

**Benefit:** Tests focused on "what" not "how"
**Evidence:** V2 documentation emphasized testing behavior over implementation

From V2's CLAUDE.md:

> "Always test BEHAVIOR, not IMPLEMENTATION. If you're testing private methods, mock internals, or exact call counts, you're doing it wrong."

**Lesson for V3:** Maintain this philosophy, document it clearly.

---

## What Didn't Work

### ❌ 1. Mock Presets Were Too Magic

**Problem:** Developers didn't understand what was being mocked

```javascript
// V2: What does this actually mock?
const mockEnv = presets.commandTest();
// Magic! Discord, API, modules all set up... but how?
```

**Impact:**

- Tests became "black boxes"
- Hard to debug when mocks didn't behave as expected
- Tight coupling to preset implementation

**V3 Solution:** Explicit mock factories where developers see what's mocked.

### ❌ 2. Too Much Manual Mocking

**Problem:** Some tests had 80+ lines of mock setup

Example from V2's `validateAvatarUrl.test.js`:

```javascript
// 80 lines of jest.mock() calls!
jest.mock('node-fetch', () => {
  /* ... */
});
jest.mock('../../src/logger', () => {
  /* ... */
});
jest.mock('../../src/utils/errorTracker', () => {
  /* ... */
});
jest.mock('../../src/utils/urlValidator', () => {
  /* ... */
});
jest.mock('../../src/utils/avatarManager', () => {
  /* ... */
});
jest.mock('../../src/webhook', () => {
  /* ... */
});
jest.mock('../../src/utils/webhookCache', () => {
  /* ... */
});
jest.mock('../../src/utils/messageDeduplication', () => {
  /* ... */
});
```

**Impact:**

- Test setup dwarfed actual test code
- Brittle tests (change one import, break many tests)
- Cognitive overload for developers

**V3 Solution:** Dependency injection + focused mock factories.

### ❌ 3. Loss of Type Safety

**Problem:** V2 used `as any` to bypass TypeScript errors in mocks

```javascript
// V2 Pattern that caused production bugs
const mockClient = {
  getAllReleases: jest.fn(), // Method doesn't actually exist!
} as any;
```

**Impact:** The `getAllReleases` bug - a method was mocked that didn't exist on the real object, causing production failures.

**V3 Solution:** Type-safe mocks that enforce interface compliance.

### ❌ 4. Separated Test Directory Structure

**Problem:** V2 had tests in a separate `tests/` directory

```
src/handlers/messageHandler.js
tests/unit/handlers/messageHandler.test.js  # Far from source
```

**Impact:**

- Hard to find relevant tests
- Parallel directory structures became out of sync
- Developers forgot to create/update tests

**V3 Solution:** Co-locate tests next to source code.

### ❌ 5. DDD Migration Created Test Complexity

**Problem:** V2's DDD migration created circular dependencies and complex bootstrap mocking

From V2's CLAUDE.md:

> "⚠️ The Service Locator Anti-Pattern: NEVER import ApplicationBootstrap in modules that it might import"

**Impact:**

- Global mocks to break circular dependencies
- Complex test setup just to avoid import cycles
- Tests coupled to DDD architecture

**V3 Solution:** Simpler architecture, no DDD over-engineering.

---

## V3 Testing Architecture

### Test Structure

```
services/bot-client/
├── src/
│   ├── utils/
│   │   ├── personalityMentionParser.ts
│   │   └── personalityMentionParser.test.ts  # Co-located!
│   └── test/
│       ├── setup.ts                          # Service setup
│       └── mocks/
│           ├── PersonalityService.mock.ts    # Type-safe factories
│           ├── UserService.mock.ts
│           └── Discord.mock.ts
├── vitest.config.ts                          # Service config
└── package.json
```

### Core Patterns

#### 1. Type-Safe Mock Factories

```typescript
// V3: Explicit, type-safe factory
export function createMockPersonalityService(personalities: MockPersonality[]): PersonalityService {
  const personalityMap = new Map(personalities.map(p => [p.name.toLowerCase(), p]));

  const mockService: PersonalityService = {
    loadPersonality: vi.fn().mockImplementation(async (name: string) => {
      const personality = personalityMap.get(name.toLowerCase());
      return personality ? mockPersonalityObject(personality) : null;
    }),
    getAllPersonalities: vi.fn().mockResolvedValue(personalities as Personality[]),
  };

  return mockService; // No `as any`!
}
```

**Key Difference:** TypeScript enforces that all methods exist!

#### 2. Dependency Injection

```typescript
// V3: Function accepts dependencies
export async function findPersonalityMention(
  content: string,
  mentionChar: string,
  personalityService: PersonalityService // Injected!
): Promise<PersonalityMentionResult | null>;
```

**Benefit:** No global state, easy to test, explicit dependencies.

#### 3. Built-in Fake Timers

```typescript
// vitest.config.ts
fakeTimers: {
  toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
}
```

**Benefit:** No custom timer injection needed, works automatically.

---

## Key Improvements

### 1. TypeScript Type Safety

**V2 Problem:** Mocks used `as any`, lost type checking
**V3 Solution:** Properly typed mocks

```typescript
// ❌ V2 Style - Compiler can't help
const mock = { method: jest.fn() } as any;

// ✅ V3 Style - Compiler enforces interface
const mock: MyService = {
  method: vi.fn().mockResolvedValue(result),
};
```

**Impact:** Compiler catches mock/interface mismatches at build time.

### 2. Co-located Tests

**V2 Problem:** Tests separated in `tests/` directory
**V3 Solution:** Tests next to source

```
personalityMentionParser.ts
personalityMentionParser.test.ts  # Right there!
```

**Impact:**

- Easier to find tests
- More likely to update tests when code changes
- Clear which modules have test coverage

### 3. Explicit Over Magic

**V2 Problem:** Preset-based mocks were opaque
**V3 Solution:** Explicit factories

```typescript
// V3: You see exactly what's mocked
beforeEach(() => {
  mockPersonalityService = createMockPersonalityService([
    { name: 'Lilith', displayName: 'Lilith', systemPrompt: '...' },
  ]);
});
```

**Impact:** Easier to debug, understand, and maintain.

### 4. Simpler Architecture

**V2 Problem:** DDD created test complexity
**V3 Solution:** Simple classes, constructor injection

```typescript
// V3: Just pass dependencies
class MessageHandler {
  constructor(
    private personalityService: PersonalityService,
    private userService: UserService
  ) {}
}
```

**Impact:** No bootstrap mocking, no circular dependency workarounds.

---

## Architectural Decisions

### Decision 1: Mock Architecture

**V2 Approach:** Presets (`presets.commandTest()`)
**V3 Approach:** Factories (`createMockPersonalityService()`)

**Rationale (from Gemini):**

> "Your V3 factory pattern is superior. It is more maintainable and scalable. Presets can become a 'black box' where developers don't understand the underlying setup."

**Implementation:** Create focused factory functions for each service.

### Decision 2: Dependency Injection

**V2 Approach:** Required constructor injection for ALL dependencies
**V3 Approach:** Constructor for classes, method parameters for functions

**Rationale (from Gemini):**

> "V2's strict enforcement was likely too rigid. Use constructor injection for your long-lived service classes and method injection for utility functions."

**Implementation:** Be pragmatic, not dogmatic.

### Decision 3: Test Organization

**V2 Approach:** Dedicated `tests/` directory
**V3 Approach:** Co-located (`.test.ts` next to source)

**Rationale (from Gemini):**

> "Placing tests next to source files is an excellent, modern practice. High visibility, easy to find and update tests when changing source code."

**Implementation:** `src/**/*.{test,spec}.ts` pattern.

### Decision 4: Fake Timers

**V2 Approach:** Custom injectable timers + ESLint enforcement
**V3 Approach:** Vitest's built-in fake timers

**Rationale (from Gemini):**

> "Absolutely stick with Vitest's built-in fake timers. They are robust, easy to use, and the industry standard. The overhead of an injectable timer service is not worth the benefit."

**Implementation:** Enable in config, use `vi.advanceTimersByTime()`.

### Decision 5: Coverage Strategy

**V2 Approach:** Mostly unit tests (testing pyramid)
**V3 Approach:** Integration-focused (testing trophy)

**Rationale (from Gemini):**

> "For microservices, a traditional 'testing pyramid' is often replaced by a 'testing honeycomb' or 'testing trophy' model, which emphasizes integration tests. Your balance should be heavily weighted towards **integration tests**."

**Implementation:**

1. Unit tests for complex business logic (parsers, algorithms)
2. **Integration tests for service interactions** (most tests here)
3. Contract tests for inter-service communication (future)
4. E2E tests for critical user journeys (minimal)

---

## Lessons Applied

### From V2's Successes

1. ✅ **Consolidated Mocks:** V3 has mock factories in `src/test/mocks/`
2. ✅ **Timer Discipline:** V3 uses fake timers by default
3. ✅ **Behavior Testing:** V3 docs emphasize testing behavior
4. ✅ **Performance Targets:** V3 aims for fast test execution

### From V2's Failures

1. ✅ **No More Magic:** V3 uses explicit factories, not presets
2. ✅ **Type Safety:** V3 enforces proper mock types
3. ✅ **Co-location:** V3 tests live next to source
4. ✅ **Simpler Architecture:** V3 avoids DDD complexity

### New in V3

1. ✅ **TypeScript:** Full type safety in tests
2. ✅ **Vitest:** Modern, faster test runner
3. ✅ **Microservices Testing:** Integration-focused strategy
4. ✅ **Clear Separation:** Each service has own test config

---

## Discord.js Mock Architecture Evolution (2025-11-01)

### The Journey from Complex to Pragmatic

**Context:** First major mock infrastructure implementation for V3. Discord.js is notoriously difficult to mock due to extensive readonly properties, type predicates, and complex union types.

**Key Participants:**

- Claude Code (implementation)
- Gemini (architectural consultation via MCP, 3 consultations)
- User (pragmatic decision-making)

### Iteration 1: vitest-mock-extended ❌

**Approach:** Use vitest-mock-extended for automatic deep mocking

```typescript
import { mock } from 'vitest-mock-extended';

const mockUser = mock<User>();
mockUser.username = 'TestUser'; // Error: readonly property!
```

**Problem:** Discord.js has extensive readonly properties. vitest-mock-extended creates readonly mocks, requiring `Object.defineProperty` for every field.

**Consultation:** Asked Gemini for alternatives.

**Result:** Abandoned after implementation attempt. Too verbose, doesn't solve readonly issue.

**Time Spent:** ~30 minutes

---

### Iteration 2: Mockable<T> Utility Type ❌

**Approach:** Create utility type to remove readonly modifiers

**Gemini Recommendation:** Use `Mockable<T>` pattern:

```typescript
type Mockable<T> = {
  -readonly [P in keyof T]?: T[P];
};

export function createMockUser(overrides: Mockable<User> = {}): User {
  const mockUser: Mockable<User> = {
    id: '123',
    username: 'Test',
    ...overrides,
  };
  return mockUser as User;
}
```

**Benefits:**

- Removes readonly modifiers
- Makes all properties optional
- Provides autocomplete during mock construction
- TypeScript validates structure

**Problem:** Object.prototype method conflicts!

```typescript
// Test code
createMockUser({ id: 'foo' });
// Error: { id: string } has toString(): string
// but User has toString(): `<@${string}>`
```

**Result:** Tests pass, TypeScript build fails on mock internals and test files (23+ errors).

**Time Spent:** ~2 hours

---

### Iteration 3: MockData<T> with Function/Non-Function Split ❌

**Approach:** Split properties into data and functions to avoid Object.prototype conflicts

**Gemini Recommendation:** Use sophisticated type splitting:

```typescript
type NonFunctionKeys<T> = {
  [K in keyof T]: T[K] extends Function ? never : K;
}[keyof T];

type FunctionKeys<T> = {
  [K in keyof T]: T[K] extends Function ? K : never;
}[keyof T];

type MockData<T> = Partial<Pick<T, NonFunctionKeys<T>>> & Partial<Pick<T, FunctionKeys<T>>>;
```

**Benefits:**

- Separates data properties from methods
- Should prevent Object.prototype conflicts
- Maintains autocomplete

**Problems:**

1. `vi.fn()` returns `Mock<>` which doesn't match type predicate signatures
2. Template literal return types still conflict
3. Typed constants required for default values: `const x: MockData<T> = {};`
4. Still complex, still getting build errors

**Attempted Fix:** Use type assertions `{} as MockData<T>` for defaults

**Result:** Still 23 build errors. Growing complexity, diminishing returns.

**Time Spent:** ~2 hours

---

### Iteration 4: Pragmatic Factory Pattern ✅

**Trigger:** User asked for Gemini consultation on best path forward.

**Gemini's Critical Insight:**

> "Your tests are passing. This is your ground truth. The TypeScript errors are about the mock's internal structure, not about whether your production code is using the dependency correctly."

**Recommendation:** Strategic combination of approaches:

1. **Plain arrow functions** for methods you don't spy on
2. **vi.fn() + @ts-expect-error** for methods you need to spy on
3. **Partial<T>** for overrides (simple!)
4. **as unknown as T** for final assertion (honest!)

**Implementation:**

```typescript
/**
 * Create a mock Discord User
 */
export function createMockUser(overrides: Partial<User> = {}): User {
  const id = overrides.id ?? '123456789012345678';

  const defaults = {
    id,
    username: 'TestUser',
    discriminator: '0',
    globalName: 'Test User',
    bot: false,
    system: false,
    tag: 'TestUser#0',
    // Plain arrow function - we don't need to spy on toString()
    toString: () => `<@${id}>`,
  } as Partial<User>;

  return { ...defaults, ...overrides } as unknown as User;
}

/**
 * Create a mock Discord Text Channel
 */
export function createMockTextChannel(overrides: Partial<TextChannel> = {}): TextChannel {
  const id = overrides.id ?? '444444444444444444';

  const defaults = {
    id,
    name: 'general',
    type: ChannelType.GuildText,
    guild: createMockGuild(),
    parent: null,
    // @ts-expect-error - Type predicates cannot be replicated by vi.fn(). Runtime behavior is correct.
    isThread: vi.fn(() => false),
    // @ts-expect-error - Type predicates cannot be replicated by vi.fn(). Runtime behavior is correct.
    isTextBased: vi.fn(() => true),
    send: vi.fn().mockResolvedValue(null),
    // Plain arrow functions - we don't need to spy on these
    toString: () => `<#${id}>`,
    valueOf: () => id,
  } as Partial<TextChannel>;

  return { ...defaults, ...overrides } as unknown as TextChannel;
}
```

**Key Decisions:**

1. **Ask: "Do I need to spy on this method?"**
   - **NO:** Plain arrow function (type-safe, simple)
   - **YES:** `vi.fn()` + `@ts-expect-error` (pragmatic)

2. **Use `@ts-expect-error` strategically:**
   - Only for unavoidable cases (type predicates, vi.fn() limitations)
   - Always with explanatory comment
   - Self-healing: fails if error disappears

3. **Accept `as unknown as T`:**
   - Honest about what we're doing
   - Mocks are "good enough" for tests
   - Tests are the safety net

**Results:**

- ✅ **39 tests passing** (22 personalityMentionParser, 17 discordContext)
- ✅ **TypeScript build passes**
- ✅ **Pre-commit hooks pass**
- ✅ **Much simpler code** (~300 lines vs complex type gymnastics)
- ✅ **Easy to understand and maintain**

**Time Spent:** ~1 hour

**Total Time:** ~5.5 hours from start to working solution

---

### Post-Mortem Analysis

#### What We Learned

**1. Perfect Type Safety in Mocks is a Fool's Errand**

Discord.js (and similar complex libraries) have:

- Readonly properties
- Type predicates (`this is Type`)
- Template literal return types (`` `<@${string}>` ``)
- Deep union types
- Object.prototype method specializations

Attempting to satisfy all of these with generic types leads to:

- Diminishing returns
- Brittle, complex code
- Hard-to-understand type errors
- Fighting the type system instead of shipping features

**2. Tests Passing > TypeScript Perfection**

The pragmatic approach acknowledges:

- Mocks only need to be "good enough" for tests
- Runtime behavior is what matters
- Type safety is valuable WHERE IT HELPS
- But not valuable WHERE IT BLOCKS

**3. Gemini's Value: Breaking Analysis Paralysis**

Three consultations provided:

1. **Mockable<T> pattern** - Better than vitest-mock-extended
2. **MockData<T> pattern** - More sophisticated, but still complex
3. **Pragmatic pattern** - Simple, maintainable, ships

Without consultation #3, we might have spent another 2-4 hours chasing perfect types.

**4. @ts-expect-error is a Tool, Not a Failure**

V2 taught us that `as any` defeats TypeScript's purpose.

But `@ts-expect-error` with clear comments is DIFFERENT:

- Documents WHY the error is expected
- Self-healing (fails if error disappears)
- Explicit, intentional, searchable
- Used strategically, not everywhere

**5. Simple Beats Complex**

```typescript
// Complex (Iteration 3): 72 lines of type gymnastics
type NonFunctionKeys<T> = ...
type FunctionKeys<T> = ...
type MockData<T> = ...
const defaultUserOverrides: MockData<User> = {};
export function createMockUser(overrides: MockData<User> = defaultUserOverrides): User { ... }

// Pragmatic (Iteration 4): Clear, simple, works
export function createMockUser(overrides: Partial<User> = {}): User {
  const defaults = { /* sensible defaults */ } as Partial<User>;
  return { ...defaults, ...overrides } as unknown as User;
}
```

The pragmatic version:

- Easier to read
- Easier to debug
- Easier to extend
- WORKS

#### Principles Extracted

**1. "Good Enough" is Good Enough**

For mocks, perfection is the enemy of progress. Mocks serve tests. If tests pass and provide value, the mock is sufficient.

**2. Use the Right Tool for the Job**

- Plain functions: For simple value returns
- `vi.fn()`: For spies and complex behavior
- `@ts-expect-error`: For unavoidable type system limits
- `as unknown as`: For honest type assertions

**3. Consult Early, Consult Often**

Gemini consultation saved ~2-4 hours by:

- Validating approaches before investing heavily
- Providing alternative patterns
- Breaking analysis paralysis with pragmatic advice

**4. Listen to the Tests**

If tests pass but TypeScript complains about mock internals, the tests are right. Mock internals don't matter to production code.

#### Documentation for Future

**When mocking complex external libraries:**

1. **Start simple:** Try `Partial<T>` + `as unknown as`
2. **Add complexity ONLY if needed:** Don't over-engineer upfront
3. **Ask yourself:** "Do I need to spy on this?"
   - No → Plain function
   - Yes → `vi.fn()` + `@ts-expect-error` if needed
4. **Consult Gemini** if stuck for > 30 minutes
5. **Ship when tests pass** - don't chase TypeScript perfection

**Red flags that you've over-engineered:**

- [ ] More than 50 lines of utility types
- [ ] Conditional types with 3+ branches
- [ ] Type errors you don't understand
- [ ] Spending >1 hour on type gymnastics
- [ ] Tests pass but build fails on mock code

**When you see these, STOP and consult.**

---

## Testing Promise Rejections with Fake Timers (2025-11-02)

### The Problem: PromiseRejectionHandledWarning

**Context:** When implementing retry and timeout utilities (PR #206), all tests were passing but Vitest was showing `PromiseRejectionHandledWarning` messages.

**Symptom:** Tests pass, but 4 unhandled promise rejection warnings appear:

```
(node:436282) PromiseRejectionHandledWarning: Promise rejection was handled asynchronously (rejection id: 6)
```

**Impact:** Despite tests passing, this indicates a potential issue with how promise rejections are being tested. In production code, unhandled rejections could crash Node.js.

---

### Root Cause Analysis

**The Race Condition:**

1. `const promise = withRetry(fn, { maxAttempts: 3 })` - Promise created (no handler yet)
2. `await vi.runAllTimersAsync()` - Timers advance, causing promise to reject
3. **Promise is rejected with NO .catch() handler attached** → Node.js issues warning
4. `await expect(promise).rejects.toThrow()` - Handler attached too late

**Why This Happens:**
When `vi.runAllTimersAsync()` executes, it synchronously processes all scheduled timers. If your code uses timers to trigger rejections (e.g., retry exhaustion, timeouts), those rejections happen immediately during `runAllTimersAsync()`. At that exact moment, Node.js checks if the promise has a rejection handler. If not, it flags it as unhandled.

---

### Failed Attempts

#### Attempt 1: try/catch with expect.assertions ❌

```typescript
it('should throw error', async () => {
  expect.assertions(2);

  try {
    const promise = withRetry(fn, { maxAttempts: 3 });
    await vi.runAllTimersAsync(); // ❌ Rejection happens here
    await promise;
  } catch (e: any) {
    expect(e).toBeInstanceOf(RetryError);
    expect(e.attempts).toBe(3);
  }
});
```

**Problem:** The `await promise` in the try block doesn't attach its .catch() handler until AFTER `runAllTimersAsync()` completes.

#### Attempt 2: Wrapper function pattern ❌

```typescript
it('should throw error', async () => {
  const action = async () => {
    const promise = withRetry(fn, { maxAttempts: 3 });
    await vi.runAllTimersAsync(); // ❌ Still rejects here
    return promise;
  };

  await expect(action()).rejects.toThrow(RetryError);
});
```

**Problem:** The rejection still occurs inside `action()` before the `.rejects` handler is attached.

---

### Solution: Attach Handlers BEFORE Advancing Timers

**Gemini's Insight:**

> "You need to ensure that the `.catch()` handler is set up to 'catch' the promise _before_ the code that causes the rejection completes."

**The Golden Rule:** Attach assertion handlers BEFORE advancing timers.

**✅ Correct Pattern:**

```typescript
it('should throw RetryError after all attempts fail', async () => {
  const error = new Error('Persistent failure');
  const fn = vi.fn().mockRejectedValue(error);

  // 1. Create the promise
  const promise = withRetry(fn, { maxAttempts: 3, initialDelayMs: 100 });

  // 2. Attach the assertion handler BEFORE advancing timers
  const assertionPromise = expect(promise).rejects.toThrow(RetryError);

  // 3. NOW advance the timers to trigger the rejection
  await vi.runAllTimersAsync();

  // 4. Await the assertion
  await assertionPromise;

  // 5. Additional synchronous assertions
  expect(fn).toHaveBeenCalledTimes(3);
});
```

**Why This Works:**

- `expect(promise).rejects.toThrow()` attaches a `.catch()` handler to the promise immediately
- When `vi.runAllTimersAsync()` triggers the rejection, the handler is already attached
- Node.js sees the handler and doesn't issue a warning
- The `assertionPromise` resolves when the assertion completes

---

### Alternative: try/catch for Error Inspection

**When to use:** You need to inspect multiple properties of the error object.

```typescript
it('should throw with specific error details', async () => {
  expect.assertions(3);

  const fn = vi.fn().mockRejectedValue(new Error('Fail'));

  try {
    const promise = withRetry(fn, { maxAttempts: 3 });
    await vi.runAllTimersAsync();
    await promise;
  } catch (e: any) {
    expect(e).toBeInstanceOf(RetryError);
    expect(e.attempts).toBe(3);
    expect(e.lastError).toBeDefined();
  }
});
```

**Note:** The `await promise` inside the try block actually DOES attach a handler before `runAllTimersAsync()` completes in this pattern, because the entire try block is part of the async function's execution context. However, the `.rejects` pattern is clearer and more idiomatic.

---

### Implementation Results

**Before:**

- 21 tests passing ✅
- 4 unhandled promise rejection warnings ⚠️

**After:**

- 21 tests passing ✅
- 0 warnings ✅
- Clean test output

**Time Invested:**

- Initial frustration: ~30 minutes trying to understand warnings
- Gemini consultation #1: Understood problem, got initial solution
- Gemini consultation #2: Refined solution after still seeing warnings
- Final implementation: ~15 minutes
- **Total:** ~1 hour (saved vs. trial and error: ~2-3 hours)

---

### Principles Extracted

**1. Order Matters with Fake Timers**

When testing code that:

- Uses timers to trigger promise rejections
- Has retry logic with delays
- Has timeout logic

You MUST attach promise handlers before advancing timers.

**2. `.rejects` is Your Friend**

The `expect().rejects.toThrow()` pattern is specifically designed for this scenario. Use it as your default for testing promise rejections with fake timers.

**3. Separate Promise Creation from Timer Advancement**

```typescript
// ✅ GOOD: Separate steps
const promise = asyncFunction();
const assertion = expect(promise).rejects.toThrow();
await vi.runAllTimersAsync();
await assertion;

// ❌ BAD: Combined
await expect(
  (async () => {
    const promise = asyncFunction();
    await vi.runAllTimersAsync();
    return promise;
  })()
).rejects.toThrow();
```

**4. Consult When Stuck**

If you see `PromiseRejectionHandledWarning` despite tests passing, don't ignore it. It indicates a test pattern issue that could mask real problems.

---

### Documentation Updates

Added guidance to:

1. **Global CLAUDE.md** (`~/.claude/CLAUDE.md` → Universal Testing Philosophy)
2. **Project Testing Guide** (`docs/guides/TESTING.md` → Testing Promise Rejections with Fake Timers)
3. **This Document** (right here!)

**Rationale:** This is a subtle issue that's easy to encounter when testing async code with fake timers. Well-documented patterns prevent future confusion.

---

### Red Flags for This Issue

Watch for these symptoms:

- Tests pass but show promise rejection warnings
- Warnings mention "handled asynchronously"
- Testing retry logic, timeout logic, or timer-based rejections
- Using `vi.runAllTimersAsync()` or `vi.advanceTimersByTime()`

**If you see these, apply the "attach handlers before advancing timers" pattern.**

---

## Summary

**V2 taught us:**

- Mocking discipline is critical
- Timer control prevents flaky tests
- Testing behavior > implementation
- BUT: Magic abstractions harm maintainability
- BUT: Separate test directories reduce visibility
- BUT: `as any` defeats TypeScript's benefits

**V3 improves by:**

- Type-safe mocks with compiler enforcement
- Explicit mock factories (no magic)
- Co-located tests for visibility
- Simpler architecture (no DDD over-engineering)
- Modern tooling (Vitest, TypeScript)
- Integration-focused test strategy

**Result:** A testing infrastructure that's faster to write, easier to maintain, and catches more bugs at compile time.

---

## Resources

- [V2 Testing CLAUDE.md](../../tzurot-legacy/tests/CLAUDE.md)
- [V2 Mock System](../../tzurot-legacy/tests/__mocks__/)
- [V3 Testing Guide](../guides/TESTING.md)
- [Gemini Code Review](./gemini-testing-review.md) (generated 2025-11-01)
