# Antipattern Review - Tzurot v3

**Date**: 2025-01-27
**Reviewer**: Architecture Review
**Context**: User flagged singletons as problematic from v2 (caused testing nightmares)

## TL;DR

**Good news**: v3 has minimal singleton usage compared to v2. The singletons we do have are:

1. **Config caching** - Acceptable (env vars don't change)
2. **Prisma client** - Acceptable (connection pooling), but needs test injection support

**Bad news**: Prisma singleton lacks mock injection for unit tests.

## Singleton Analysis

### ✅ Acceptable Singleton: Config (`packages/common-types/src/config.ts`)

**Pattern**:

```typescript
let _config: EnvConfig | undefined;

export function getConfig(): EnvConfig {
  _config ??= validateEnv();
  return _config;
}

export function resetConfig(): void {
  _config = undefined;
}
```

**Justification**:

- Environment variables are truly global and don't change at runtime
- Caching prevents repeated validation overhead
- `resetConfig()` function allows tests to inject different env vars

**Testing Impact**: ✅ Minimal

```typescript
// In tests:
beforeEach(() => {
  process.env.FOO = 'test-value';
  resetConfig(); // Clear cache
});
```

**Recommendation**: Keep as-is.

---

### ⚠️ Problematic Singleton: Prisma (`packages/common-types/src/services/prisma.ts`)

**Pattern**:

```typescript
let prismaClient: PrismaClient | null = null;

export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient({ ... });
  }
  return prismaClient;
}
```

**Justification**:

- Prisma manages a connection pool internally
- Multiple PrismaClient instances would create multiple pools (wasteful)
- Singleton ensures one pool per process

**Testing Impact**: ❌ **High**

- Cannot inject mock Prisma client for unit tests
- Tests must use real database or complex mocking
- Same issue that caused v2 testing nightmares

**Examples of pain**:

```typescript
// In ConversationalRAGService.ts
const prisma = getPrismaClient(); // ❌ Can't mock this!

// In tests, we're forced to:
// 1. Use real database (slow, flaky)
// 2. Mock at Prisma level (complex, brittle)
// 3. Use Prisma's mockDeep (limited)
```

**Recommendation**: Refactor to dependency injection (see solution below).

## Antipattern: Service-Level Singletons

### Current State: ✅ **No service-level singletons!**

Unlike v2's DDD nightmare, v3 services are **properly instantiated**:

```typescript
// ✅ Good: Instance-based service
export class ConversationalRAGService {
  private memoryManager?: QdrantMemoryAdapter;
  private models = new Map<string, ChatModelResult>();

  constructor(memoryManager?: QdrantMemoryAdapter) {
    this.memoryManager = memoryManager;
  }
}

// Usage
const ragService = new ConversationalRAGService(memoryAdapter);
```

This is **excellent** because:

- Services are testable (inject mocks via constructor)
- No global state
- Clear dependencies

**Recommendation**: Maintain this pattern. Do NOT convert to singletons.

## Antipattern: God Objects

### Current State: ⚠️ **Minor concern**

**`ConversationalRAGService`** is doing a lot:

- Building prompts
- Managing conversation history
- Querying memories
- Formatting attachments
- Storing interactions
- User persona lookup

**Size**: ~700 lines

**Concerns**:

- Violates Single Responsibility Principle
- Hard to test individual pieces
- High cognitive load

**Recommendation**: Consider splitting into:

1. `PromptBuilder` - Assemble prompts from components
2. `MemoryRetriever` - Query and filter LTM/STM
3. `ConversationService` - Orchestrate the flow

**Priority**: Low (current size is manageable, but watch for growth)

## Antipattern: Hidden Dependencies

### Current State: ⚠️ **Found in ConversationalRAGService**

**Problem**: Direct imports of singletons inside methods

```typescript
// In storeInteraction()
const prisma = getPrismaClient(); // ❌ Hidden dependency

// In getUserPersona()
const { getPrismaClient } = await import('@tzurot/common-types');
const prisma = getPrismaClient(); // ❌❌ Dynamic import + hidden dependency!
```

**Why it's bad**:

- Not obvious from constructor what dependencies service needs
- Can't mock Prisma in tests
- Violates Dependency Inversion Principle

**Recommendation**: Inject Prisma via constructor (see solution below).

## Antipattern: Mutable Module-Level State

### Current State: ✅ **None found**

v3 does NOT have module-level mutable state like:

```typescript
// ❌ BAD (v2 did this)
let globalPersonalities: Map<string, Personality>;
```

All state is encapsulated in class instances. Good!

## Antipattern: Circular Dependencies

### Current State: ✅ **None detected**

Quick check shows clean dependency graph:

```
common-types → (no deps)
ai-worker → common-types
bot-client → common-types
api-gateway → common-types
```

No circular imports. Good architecture!

## Proposed Solutions

### Solution 1: Make Prisma Injectable (High Priority)

**Goal**: Allow test mocking while keeping singleton in production

**Approach**: Optional injection pattern

**Implementation**:

```typescript
// packages/common-types/src/services/prisma.ts
let prismaClient: PrismaClient | null = null;

/**
 * Get or create the Prisma client
 * For testing, call setPrismaClient() before using this function
 */
export function getPrismaClient(): PrismaClient {
  if (!prismaClient) {
    prismaClient = new PrismaClient({ ... });
    logger.info('Prisma client initialized');
  }
  return prismaClient;
}

/**
 * Set a custom Prisma client (for testing)
 * WARNING: Only use in tests!
 */
export function setPrismaClient(client: PrismaClient): void {
  if (prismaClient && config.NODE_ENV === 'production') {
    throw new Error('Cannot replace Prisma client in production!');
  }
  prismaClient = client;
}

/**
 * Reset Prisma client (for testing)
 */
export function resetPrismaClient(): void {
  prismaClient = null;
}
```

**Usage in tests**:

```typescript
import { setPrismaClient, resetPrismaClient } from '@tzurot/common-types';
import { mockDeep } from 'vitest-mock-extended';

beforeEach(() => {
  const mockPrisma = mockDeep<PrismaClient>();
  setPrismaClient(mockPrisma);
});

afterEach(() => {
  resetPrismaClient();
});
```

**Benefits**:

- ✅ Production code unchanged (still uses singleton)
- ✅ Tests can inject mocks
- ✅ Simple implementation
- ✅ Guards against accidental production injection

### Solution 2: Dependency Injection for ConversationalRAGService (Medium Priority)

**Goal**: Make Prisma a constructor dependency, not hidden import

**Implementation**:

```typescript
export class ConversationalRAGService {
  private memoryManager?: QdrantMemoryAdapter;
  private models = new Map<string, ChatModelResult>();
  private prisma: PrismaClient; // ✅ Explicit dependency

  constructor(
    memoryManager?: QdrantMemoryAdapter,
    prisma?: PrismaClient // ✅ Optional injection (defaults to singleton)
  ) {
    this.memoryManager = memoryManager;
    this.prisma = prisma || getPrismaClient();
  }

  // Now all methods use this.prisma instead of getPrismaClient()
  private async storeInteraction(...) {
    const conversationRecord = await this.prisma.conversationHistory.create({ ... });
  }

  private async getUserPersona(...) {
    const user = await this.prisma.user.findUnique({ ... });
  }
}
```

**Benefits**:

- ✅ Dependencies obvious from constructor
- ✅ Easy to mock in tests
- ✅ Follows SOLID principles
- ✅ No behavior change in production

**Testing becomes trivial**:

```typescript
const mockPrisma = mockDeep<PrismaClient>();
const service = new ConversationalRAGService(memoryAdapter, mockPrisma);
```

### Solution 3: Consider PromptBuilder Extraction (Low Priority)

**Goal**: Reduce `ConversationalRAGService` complexity

**Implementation**:

```typescript
// New file: PromptBuilder.ts
export class PromptBuilder {
  buildFullSystemPrompt(
    personality: LoadedPersonality,
    userPersona: string | null,
    relevantMemories: any[],
    context: ConversationContext
  ): string {
    // Extract all prompt assembly logic here
  }

  buildHumanMessage(...): HumanMessage {
    // Extract message building logic
  }
}

// ConversationalRAGService becomes:
export class ConversationalRAGService {
  private promptBuilder: PromptBuilder;

  async generateResponse(...) {
    const systemPrompt = this.promptBuilder.buildFullSystemPrompt(...);
    const humanMessage = this.promptBuilder.buildHumanMessage(...);
    // ... rest of generation logic
  }
}
```

**Benefits**:

- ✅ Single Responsibility Principle
- ✅ Easier to test prompt logic in isolation
- ✅ Reduces ConversationalRAGService complexity

**When to do this**: When `ConversationalRAGService` exceeds ~1000 lines or becomes hard to understand.

## Comparison to v2

| Aspect                | v2 (DDD)                                   | v3 (Simple)       | Improvement |
| --------------------- | ------------------------------------------ | ----------------- | ----------- |
| Service singletons    | Many (PersonalityManager, AIService, etc.) | None              | ✅ Major    |
| Module-level state    | Extensive                                  | None              | ✅ Major    |
| Circular dependencies | Common                                     | None              | ✅ Major    |
| God objects           | Several                                    | One minor concern | ✅ Good     |
| Hidden dependencies   | Everywhere                                 | A few instances   | ⚠️ Minor    |
| Testability           | Nightmare                                  | Mostly good       | ✅ Major    |

**Overall**: v3 architecture is **significantly better** than v2.

## Action Items

### Immediate (This Week)

1. ✅ Add `setPrismaClient()` and `resetPrismaClient()` to `prisma.ts`
2. ✅ Update `ConversationalRAGService` to accept Prisma in constructor
3. ✅ Document injection pattern for tests

### Short Term (Next Sprint)

4. Review `PersonalityService` for similar hidden dependencies
5. Add example unit tests demonstrating mock injection

### Long Term (Future)

6. Monitor `ConversationalRAGService` size - consider splitting if > 1000 lines
7. Establish code review checkpoint: "Are we introducing singletons?"

## Conclusion

v3 has **excellent** architecture compared to v2:

- Minimal singleton usage
- Clean dependency injection in services
- No module-level mutable state

The only issue is Prisma lacking test injection support, which is easily fixed with the proposed `setPrismaClient()` function.

**Verdict**: ✅ v3 architecture is solid. Minor improvements needed for testing.
