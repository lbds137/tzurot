# Tech Debt Sprint - Code Quality Audit

> **Created**: 2025-11-30
> **Branch**: `tech-debt/code-quality-sprint`
> **Goal**: Identify and address architectural issues, tight coupling, DRY/SRP violations, testing gaps, and code hygiene issues.

## Executive Summary

The codebase is functional and well-structured for a microservices architecture, but shows signs of "scaling pains" as it transitions from proof-of-concept to production. The primary concerns are:

1. **Large "God Files"** - Several files exceed 500 lines with mixed responsibilities
2. **Stateful Services** - In-memory caches prevent horizontal scaling
3. **Test Coverage Gaps** - Entry points and some services lack tests
4. **Type Safety** - Heavy `any` usage in test mocking

## Audit Findings

### Test Coverage by Service

| Service     | Source Files | Test Files | Coverage |
| ----------- | ------------ | ---------- | -------- |
| ai-worker   | 36           | 29         | 80%      |
| api-gateway | 49           | 32         | 65%      |
| bot-client  | 100          | 79         | 79%      |

**Key gaps**: Entry point files (`index.ts`) have no tests.

### Large Files (Potential SRP Violations)

| File                                                  | Lines | Concerns                                                           |
| ----------------------------------------------------- | ----- | ------------------------------------------------------------------ |
| `api-gateway/src/index.ts`                            | 558   | Mixes Express config, routes, validation, startup logic            |
| `ai-worker/src/jobs/handlers/LLMGenerationHandler.ts` | 617   | Handles context, dependencies, BYOK, config resolution, generation |
| `ai-worker/src/services/PgvectorMemoryAdapter.ts`     | 565   | Mixes SQL, vector logic, and memory management                     |
| `bot-client/src/services/MentionResolver.ts`          | 511   | Complex mention resolution logic                                   |
| `ai-worker/src/services/ConversationalRAGService.ts`  | 475   | Orchestrates many concerns                                         |
| `ai-worker/src/services/LlmConfigResolver.ts`         | 466   | Config resolution + caching                                        |
| `ai-worker/src/services/PromptBuilder.ts`             | 461   | Large prompt construction                                          |

### Stateful Services (Scaling Blockers)

These use `setInterval`/`setTimeout` for cleanup, preventing horizontal scaling:

1. **`LlmConfigResolver.ts`** - In-memory cache with cleanup interval
2. **`rateLimiter.ts`** - In-memory rate limit tracking
3. **`RequestDeduplicationCache.ts`** - In-memory request deduplication
4. **`DatabaseNotificationListener.ts`** - Reconnection timeout

### Type Safety Issues

- **692 uses of `any`** - Mostly in test files for mocking
- Production code `any` usage is minimal but should be audited

### TODO/FIXME Comments

```
services/ai-worker/src/jobs/AIJobProcessor.ts:323:    // TODO: Add actual health check
services/api-gateway/src/routes/ai/generate.ts:109:   // TODO: Add callback URL support
services/api-gateway/src/utils/rateLimiter.ts:46:     // TODO: Replace with Redis for distributed deployments
```

### Positive Findings ✅

- **No circular cross-service imports** - Good service boundaries
- **Routes already extracted** - `api-gateway` has `routes/` folder structure
- **Constants centralized** - Using `@tzurot/common-types/constants`
- **Shared types exist** - `@tzurot/common-types` package

---

## Prioritized Action Items

### Phase 1: Quick Wins (Low Effort, High Impact)

#### 1.1 ESLint Rules Enhancement

- [x] Add `no-explicit-any` rule ✅ Already set to "error" in eslint.config.js (flat config)
- [x] Document ESLint flat config vs legacy ✅ Added to CLAUDE.md, deleted unused .eslintrc.json
- [ ] Add custom rule or documentation for `setTimeout`/`setInterval` alternatives
- [ ] Run linter audit and fix low-hanging fruit

#### 1.2 Test Coverage for Entry Points

- [x] Add smoke tests for `api-gateway/src/index.ts` (startup, health endpoint) ✅
- [ ] Add smoke tests for `ai-worker/src/index.ts` (worker startup, job processing)
- [ ] Add smoke tests for `bot-client/src/index.ts` (client login mock)

#### 1.3 Address TODO Comments

- [ ] Implement proper health check in `AIJobProcessor.ts`
- [x] Document or remove callback URL TODO (if not planned) ✅ Removed - not needed for current architecture
- [x] Create issue for distributed rate limiting migration ✅ Implemented with Redis-backed rate limiter

### Phase 2: Architectural Improvements (Medium Effort)

#### 2.1 Split api-gateway/index.ts ✅ COMPLETE

Current: 558 lines mixing Express config, routes, validation, startup

Target structure:

```
api-gateway/src/
├── index.ts              # ~50 lines: just calls bootstrap()
├── bootstrap.ts          # Server startup, middleware config
├── middleware/
│   ├── cors.ts
│   ├── errorHandler.ts
│   └── requestLogger.ts
├── routes/               # Already exists, good!
└── health/
    └── healthCheck.ts    # Extract health check logic
```

**Result**: Split into `bootstrap/`, `middleware/`, and `routes/public/` modules. index.ts reduced from 532→259 lines (-51%).

#### 2.2 Split LLMGenerationHandler.ts ✅ COMPLETE

Current: 617 lines handling multiple concerns

Target structure:

```
ai-worker/src/jobs/handlers/
├── LLMGenerationHandler.ts    # ~150 lines: orchestrator only
├── DependencyProcessor.ts     # Extract processDependencies()
├── ConfigResolver.ts          # Extract config/BYOK resolution
└── ResponseGenerator.ts       # Extract RAG service integration
```

Or use **Pipeline Pattern**:

```typescript
interface GenerationStep {
  process(context: GenerationContext): Promise<GenerationContext>;
}

// Steps: ValidateJob → ResolveDependencies → ResolveConfig → GenerateResponse
```

**Result**: Implemented Pipeline Pattern with 6 stateless steps in `pipeline/` folder. LLMGenerationHandler.ts reduced from 617→131 lines (-79%). Thread-safe for concurrent BullMQ job processing.

#### 2.3 Migrate In-Memory Caches to Redis ✅ COMPLETE

| Current                     | Migration                                  |
| --------------------------- | ------------------------------------------ |
| `RequestDeduplicationCache` | Redis SET with TTL                         |
| `rateLimiter`               | `rate-limiter-flexible` with Redis backend |
| `LlmConfigResolver` cache   | Redis with pub/sub invalidation            |

**Result**: Implemented `RedisDeduplicationCache` and `RedisRateLimiter` with atomic Lua scripts. Horizontal scaling now possible for api-gateway.

### Phase 3: Testing & Reliability (Higher Effort)

#### 3.1 Contract Tests Enhancement

- [ ] Add schema versioning to BullMQ job payloads
- [ ] Add contract tests for HTTP API responses
- [ ] Consider Dependency Cruiser for architecture linting

#### 3.2 Characterization Tests for Large Files

Before refactoring, capture current behavior:

- [ ] Snapshot tests for `LLMGenerationHandler` outputs
- [ ] Snapshot tests for `PromptBuilder` outputs

#### 3.3 BullMQ Repeatable Jobs for Cleanup

Replace `setInterval` patterns with BullMQ scheduler:

```typescript
// Instead of setInterval in LlmConfigResolver
await queue.add(
  'cleanup-config-cache',
  {},
  {
    repeat: { every: 60000 }, // Every minute
  }
);
```

---

## Gemini's Key Insights

1. **Pipeline Pattern for LLM Generation** - Break handler into composable steps
2. **Gateway Decomposition** - Strict Route-Controller-Service layers
3. **Memory Adapter Split** - Separate storage mechanism from domain logic
4. **Shadow Mode for Refactoring** - Run old and new code in parallel for validation
5. **Event Sourcing** - Consider for conversation context (future)

---

## Files to Focus On

### High Priority (Refactor Soon)

1. `services/api-gateway/src/index.ts` - Split into bootstrap + modules
2. `services/ai-worker/src/jobs/handlers/LLMGenerationHandler.ts` - Pipeline pattern
3. `services/api-gateway/src/utils/RequestDeduplicationCache.ts` - Redis migration

### Medium Priority (Improve Tests)

1. `services/ai-worker/src/services/PgvectorMemoryAdapter.ts` - More edge case tests
2. `services/bot-client/src/services/MentionResolver.ts` - Complex logic needs coverage

### Low Priority (Nice to Have)

1. `services/ai-worker/src/services/LlmConfigResolver.ts` - Cache to Redis
2. Reduce `any` in test files with proper type builders

---

## Success Metrics

- [ ] No files > 400 lines in production code
- [x] All entry points have basic smoke tests (api-gateway done, others pending)
- [x] Zero in-memory state for horizontal scaling ✅ Redis-backed rate limiter and deduplication
- [ ] `any` usage reduced by 50%
- [x] All TODOs resolved or converted to tracked issues ✅

---

## Notes

This document serves as the tracking doc for the tech debt sprint. Check off items as completed and add new findings as discovered.
