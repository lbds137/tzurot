# Technical Debt Prioritization - November 2025

**Date**: 2025-11-20
**Focus**: Code quality, architecture cleanup, reducing complexity
**Status**: Planning Phase

> This document prioritizes technical debt work based on code analysis. Focus is on streamlining architecture, reducing duplication, and improving maintainability before adding new features.

---

## Table of Contents

1. [Analysis Summary](#analysis-summary)
2. [Priority 1: Large File Refactoring](#priority-1-large-file-refactoring-high-impact)
3. [Priority 2: Code Duplication](#priority-2-code-duplication-medium-impact)
4. [Priority 3: Architecture Streamlining](#priority-3-architecture-streamlining-medium-impact)
5. [Priority 4: Pending TODOs](#priority-4-pending-todos-low-impact)
6. [Implementation Order](#implementation-order)

---

## Analysis Summary

**Codebase Health**:

- ✅ **Constants**: Well-organized! Most magic numbers already extracted to `constants/`
- ⚠️ **File Size**: 9 files >350 lines, some approaching 550 lines
- ⚠️ **Code Duplication**: Repeated patterns in route handlers, error handling, validation
- ✅ **Type Safety**: Strong Zod validation throughout
- ⚠️ **Architecture**: Some services doing too much, opportunity for better separation

**Key Metrics**:

- **Large files (>350 LOC)**: 9 files
- **TODO/FIXME comments**: 2 actionable items
- **Utility functions**: 153 functions (many already well-organized)
- **Magic numbers remaining**: ~15 hardcoded values outside constants

---

## Priority 1: Large File Refactoring (High Impact)

**Why This Matters**: Large files are hard to navigate, test, and modify. Breaking them down improves maintainability and makes the codebase more approachable.

### 1.1 Split `admin.ts` Route Handler (525 lines)

**Current State**: Single file with 5 major endpoints (db-sync, POST personality, GET personality, PATCH personality, DELETE personality)

**Problem**:

- Massive file makes navigation difficult
- Each route has its own async IIFE wrapper (code duplication)
- Hard to find specific endpoints
- Validation logic mixed with business logic

**Proposed Structure**:

```
api-gateway/src/routes/admin/
├── index.ts                   # Router setup + middleware
├── dbSync.ts                  # Database sync endpoint
├── personalities/
│   ├── create.ts             # POST /personality
│   ├── read.ts               # GET /personality/:slug
│   ├── update.ts             # PATCH /personality/:slug
│   └── delete.ts             # DELETE /personality/:slug
└── utils/
    ├── validation.ts          # Shared validation logic
    └── errorHandling.ts       # Shared error response logic
```

**Benefits**:

- Each file <150 lines
- Clear separation of concerns
- Easier to test individual endpoints
- Shared utilities eliminate duplication

**Estimated Effort**: Medium (4-6 hours)

---

### 1.2 Refactor `PersonalityService.ts` (502 lines)

**Current State**: Monolithic service handling:

- Zod schema definitions
- Database queries
- Caching logic
- Default value merging
- Avatar URL generation
- Validation

**Problem**:

- Too many responsibilities in one file
- Hard to test specific pieces
- Mixing data access, validation, and presentation logic

**Proposed Structure**:

```
common-types/src/services/personality/
├── PersonalityService.ts          # Main orchestrator (~150 lines)
├── PersonalityLoader.ts           # Database queries (~100 lines)
├── PersonalityValidator.ts        # Zod schemas + validation (~100 lines)
├── PersonalityCache.ts            # Already separate! ✅
└── PersonalityDefaults.ts         # Default merging logic (~80 lines)
```

**What Stays in PersonalityService**:

- Public API methods (loadPersonality, etc.)
- Orchestration between loader, validator, cache
- High-level error handling

**What Gets Extracted**:

- `PersonalityValidator.ts`: All Zod schemas + `parseLlmConfig()`
- `PersonalityLoader.ts`: All Prisma queries + avatar URL generation
- `PersonalityDefaults.ts`: `mergeWithDefaults()` logic

**Benefits**:

- Each file has single responsibility
- Easier to test validation separately from data access
- PersonalityService becomes clean orchestrator

**Estimated Effort**: Medium-High (6-8 hours)

---

### 1.3 Split `ai.ts` Route Handler (418 lines)

**Current State**: Single file with multiple endpoints (generate, transcribe, describe-image)

**Problem**:

- Similar to admin.ts - large route file
- Repeated async IIFE pattern
- Validation and error handling duplicated

**Proposed Structure**:

```
api-gateway/src/routes/ai/
├── index.ts                   # Router setup
├── generate.ts                # /ai/generate endpoint
├── transcribe.ts              # /ai/transcribe endpoint
└── describeImage.ts           # /ai/describe-image endpoint
```

**Benefits**:

- Clear endpoint separation
- Easier to find and modify specific endpoints
- Can share validation utilities with admin routes

**Estimated Effort**: Medium (3-4 hours)

---

### 1.4 Refactor `ConversationHistoryService.ts` (443 lines)

**Current State**: Large service handling conversation CRUD operations

**Analysis**:

- Actually pretty well-structured internally
- Methods are focused
- Mostly database operations

**Recommendation**: **LOW PRIORITY** - This file is large but well-organized. The methods are cohesive and serve a single purpose (conversation history management). Refactoring would provide minimal benefit.

**Alternative**: If we want to reduce size, extract pagination logic to `ConversationPaginator.ts` (~80 lines)

---

### 1.5 Extract Components from `PromptBuilder.ts` (425 lines)

**Current State**: Already identified in V3_REFINEMENT_ROADMAP.md (Tier 1.2)

**Status**: Documented in roadmap, should be prioritized

**Proposed Structure** (from roadmap):

```
ai-worker/src/services/prompt/
├── PromptBuilder.ts           # Main orchestrator
├── EnvironmentFormatter.ts    # Date, location, participants
├── MemoryFormatter.ts          # Memory formatting
└── ParticipantFormatter.ts    # User/personality details
```

**Estimated Effort**: Medium (5-6 hours)

---

## Priority 2: Code Duplication (Medium Impact)

### 2.1 Route Handler Async IIFE Pattern

**Location**: `admin.ts`, `ai.ts`

**Current Pattern** (repeated 8+ times):

```typescript
router.post('/endpoint', middleware, (req: Request, res: Response) => {
  void (async () => {
    try {
      // ... handler logic ...
    } catch (error) {
      logger.error({ err: error }, 'Error message');
      const errorResponse = ErrorResponses.someError(message);
      res.status(getStatusCode(errorResponse.error)).json(errorResponse);
    }
  })();
});
```

**Problem**:

- Boilerplate repeated for every route
- Easy to forget proper error handling
- Inconsistent error response formatting

**Solution**: Create wrapper utility

```typescript
// api-gateway/src/utils/asyncHandler.ts
export function asyncHandler(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => {
    void (async () => {
      try {
        await handler(req, res);
      } catch (error) {
        logger.error({ err: error }, 'Request handler error');
        const errorResponse = ErrorResponses.internalError(
          error instanceof Error ? error.message : 'Internal server error'
        );
        res.status(getStatusCode(errorResponse.error)).json(errorResponse);
      }
    })();
  };
}
```

**Usage**:

```typescript
router.post(
  '/personality',
  requireOwnerAuth(),
  asyncHandler(async (req, res) => {
    // Just write the happy path, wrapper handles errors
    const result = await createPersonality(req.body);
    res.json({ success: true, data: result });
  })
);
```

**Benefits**:

- Eliminates ~20 lines per route
- Consistent error handling
- Easier to add logging, metrics, etc.

**Estimated Effort**: Low (2-3 hours including refactor of all routes)

---

### 2.2 Validation Logic Duplication

**Location**: `admin.ts` (multiple endpoints validate similar things)

**Problem**:

- Slug validation repeated
- customFields validation repeated
- Avatar processing repeated

**Example Duplication**:

```typescript
// Repeated in POST and PATCH routes
if (!/^[a-z0-9-]+$/.test(slug)) {
  const errorResponse = ErrorResponses.validationError(
    'Invalid slug format. Use only lowercase letters, numbers, and hyphens.'
  );
  res.status(getStatusCode(errorResponse.error)).json(errorResponse);
  return;
}
```

**Solution**: Extract to validation utilities

```typescript
// api-gateway/src/utils/validators.ts
export function validateSlug(slug: string): { valid: boolean; error?: ErrorResponse } {
  if (!/^[a-z0-9-]+$/.test(slug)) {
    return {
      valid: false,
      error: ErrorResponses.validationError(
        'Invalid slug format. Use only lowercase letters, numbers, and hyphens.'
      ),
    };
  }
  return { valid: true };
}

export function validateCustomFields(fields: unknown): { valid: boolean; error?: ErrorResponse } {
  if (fields !== undefined && fields !== null) {
    const validation = customFieldsSchema.safeParse(fields);
    if (!validation.success) {
      return {
        valid: false,
        error: ErrorResponses.validationError(`Invalid customFields: ${validation.error.message}`),
      };
    }
  }
  return { valid: true };
}
```

**Benefits**:

- DRY principle
- Easier to update validation rules
- Can add unit tests for validators

**Estimated Effort**: Low (2 hours)

---

### 2.3 Error Response Creation Pattern

**Location**: Throughout all services

**Problem**:

- Repeated pattern of creating error response + getting status code + sending JSON
- Verbose and error-prone

**Current Pattern**:

```typescript
const errorResponse = ErrorResponses.validationError(message);
res.status(getStatusCode(errorResponse.error)).json(errorResponse);
return;
```

**Solution**: Helper function

```typescript
// api-gateway/src/utils/responseHelpers.ts
export function sendError(res: Response, errorResponse: ErrorResponse): void {
  res.status(getStatusCode(errorResponse.error)).json(errorResponse);
}

export function sendSuccess<T>(res: Response, data: T, statusCode = StatusCodes.OK): void {
  res.status(statusCode).json({ success: true, data });
}
```

**Usage**:

```typescript
// Before (5 lines)
const errorResponse = ErrorResponses.validationError(message);
res.status(getStatusCode(errorResponse.error)).json(errorResponse);
return;

// After (1 line)
return sendError(res, ErrorResponses.validationError(message));
```

**Benefits**:

- Cleaner route handlers
- Consistent response formatting
- Easy to add logging/metrics later

**Estimated Effort**: Very Low (1 hour)

---

## Priority 3: Architecture Streamlining (Medium Impact)

### 3.1 Utility Functions vs Classes

**Analysis**: Current approach is actually pretty good!

**Well-Organized Utils**:

- `discord.ts` - Pure functions for Discord message handling ✅
- `tokenCounter.ts` - Pure functions for token estimation ✅
- `logger.ts` - Factory function for logger creation ✅
- `errorHandling.ts` - Pure error transformation functions ✅

**Could Be Classes**:

- `retryService.ts` (327 lines) - Complex retry logic with config
  - **Recommendation**: Consider `RetryService` class if we need instance-specific config
  - **Current**: Works fine as standalone functions
  - **Priority**: LOW - don't fix what isn't broken

**Verdict**: ✅ **No action needed** - Current utility organization is sensible

---

### 3.2 Service Layer Consistency

**Issue**: Some inconsistency in how services are structured

**Current Patterns**:

1. **Class-based services** (PersonalityService, ConversationHistoryService, DatabaseSyncService)
2. **Standalone functions** (redis.ts exports functions, not a class)

**Analysis**:

- redis.ts could be `RedisService` class
- Would provide better encapsulation
- Could make testing easier (inject mock Redis client)

**Recommendation**: **MEDIUM PRIORITY**

```typescript
// Before (redis.ts)
export async function getJobResult<T>(jobId: string): Promise<T | null> {
  const redis = getRedis();
  // ...
}

// After (RedisService.ts)
export class RedisService {
  constructor(private redis: Redis) {}

  async getJobResult<T>(jobId: string): Promise<T | null> {
    // ...
  }

  async publishJobResult(jobId: string, result: unknown): Promise<void> {
    // ...
  }
}
```

**Benefits**:

- Dependency injection (easier testing)
- Consistent service pattern
- Better encapsulation

**Estimated Effort**: Medium (3-4 hours)

---

### 3.3 Prisma Client Instantiation

**Status**: ✅ **Already tracked in TECHNICAL_DEBT.md**

**Issue**: `PgvectorMemoryAdapter.ts` creates its own PrismaClient

**Recommendation**: Use shared singleton from `common-types/src/services/prisma.ts`

**Priority**: MEDIUM (already documented, just needs implementation)

---

## Priority 4: Pending TODOs (Low Impact)

### 4.1 AIJobProcessor Health Check

**Location**: `services/ai-worker/src/jobs/AIJobProcessor.ts:230`

```typescript
// TODO: Add actual health check
```

**Current**: Returns `{ status: 'ok' }` always

**Recommendation**: Add actual checks:

- Redis connection status
- Prisma connection status
- Queue worker status

**Priority**: LOW

---

### 4.2 Callback URL Support

**Location**: `services/api-gateway/src/routes/ai.ts:135`

```typescript
// TODO: Add callback URL support
```

**Context**: For long-running jobs (webhook pattern instead of `wait=true`)

**Status**: Already documented in V3_REFINEMENT_ROADMAP.md (Tier 6.6)

**Priority**: LOW (feature enhancement, not tech debt)

---

## Implementation Order

### Phase 1: Quick Wins (1-2 days)

1. **Error Response Helpers** (1 hour) - Immediate reduction in boilerplate
2. **Async Handler Wrapper** (3 hours) - Cleaner route handlers
3. **Validation Utilities** (2 hours) - Remove duplication

**Impact**: Cleaner, more maintainable route handlers

---

### Phase 2: Large File Refactoring (1 week)

1. **Split admin.ts** (6 hours) - Biggest file, high impact
2. **Split ai.ts** (4 hours) - Second priority
3. **Refactor PromptBuilder.ts** (6 hours) - Already planned in roadmap

**Impact**: More navigable codebase, easier to find and modify code

---

### Phase 3: Service Improvements (3-4 days)

1. **Refactor PersonalityService.ts** (8 hours) - Complex but worth it
2. **Convert redis.ts to RedisService** (4 hours) - Architecture consistency
3. **Fix PrismaClient instantiation** (2 hours) - Already documented issue

**Impact**: Better separation of concerns, easier testing

---

### Phase 4: Architectural Improvements (As Needed)

1. **Extract ConversationPaginator** (optional)
2. **Implement health checks** (nice-to-have)
3. **Callback URL support** (feature work, see roadmap)

**Impact**: Polish and feature enhancements

---

## Magic Numbers Status

**Analysis**: ✅ **Already well-handled!**

Most numbers are in `constants/`:

- `TIMEOUTS` - All timeout values
- `INTERVALS` - Polling intervals
- `CACHE_TTL` - Cache durations
- `AVATAR_LIMITS` - Avatar size limits
- `MESSAGE_LIMITS` - Discord limits

**Remaining Hardcoded Values** (~15 instances):

- Mostly multiplication by `1000` (seconds to milliseconds conversion)
- Some inline timeouts in specific files (GatewayClient.ts)

**Recommendation**: **LOW PRIORITY** - Current state is good, only extract if we see duplication

---

## Summary

### Top 5 Recommendations (By Impact)

1. **Phase 1 Quick Wins** (Error helpers, async wrapper, validators)
   - Immediate quality of life improvement
   - Low effort, high impact
   - Makes future work easier

2. **Split admin.ts** (525 lines → 5 files of ~100 lines)
   - Biggest file in codebase
   - High navigability improvement
   - Enables better testing

3. **Refactor PersonalityService.ts** (502 lines → 4 files of ~120 lines)
   - Complex service with multiple responsibilities
   - Better separation of concerns
   - Easier to maintain and test

4. **Split ai.ts** (418 lines → 3 files of ~140 lines)
   - Route organization consistency
   - Clearer endpoint separation

5. **Refactor PromptBuilder.ts** (Already in roadmap Tier 1.2)
   - Critical for AI quality
   - Already identified as priority
   - Clear decomposition plan

### Defer/Low Priority

- Converting utilities to classes (current approach is fine)
- ConversationHistoryService refactor (well-structured already)
- Health check implementation (nice-to-have)
- Additional constant extraction (diminishing returns)

---

## Next Steps

1. **Review this document** - Discuss priorities
2. **Pick Phase 1 or Phase 2** - Start with quick wins or dive into refactoring
3. **Create GitHub Issues** - Track individual refactoring tasks
4. **Set aside focused time** - Refactoring needs uninterrupted blocks
5. **Test thoroughly** - Each refactor should maintain exact behavior

**Remember**: This is tech debt work, not features. Take time to do it right. The goal is **reducing complexity**, not adding it.
