# Technical Debt

This document tracks known technical debt items that should be addressed in future work.

**Last Updated**: 2025-10-31

---

## Critical Priority

_No critical priority items at this time._

---

## High Priority

_No high priority items at this time._

---

## Medium Priority

### PrismaClient Instantiation Pattern

**Location**: `services/ai-worker/src/memory/PgvectorMemoryAdapter.ts:68`

**Issue**: Creates new PrismaClient instance in adapter without singleton pattern.

```typescript
this.prisma = new PrismaClient();
```

**Impact**:
- If multiple adapters are instantiated, creates multiple database connection pools
- Wastes database connections
- May hit connection pool limits in production

**Current Mitigation**:
- Only one PgvectorMemoryAdapter instance is created per ai-worker process
- Low immediate risk

**Recommended Fix**:
1. Create shared Prisma singleton utility:
   ```typescript
   // shared/prisma.ts
   let prismaClient: PrismaClient | undefined;

   export function getPrismaClient(): PrismaClient {
     if (!prismaClient) {
       prismaClient = new PrismaClient();
     }
     return prismaClient;
   }
   ```
2. Use shared instance in adapter
3. Handle graceful shutdown

**Tracking**:
- Created: 2025-10-31
- Discovered during code review for PR #190
- Low priority since single instance pattern is enforced by application architecture

---

## Low Priority

_No low priority items at this time._

---

## Completed / Resolved

### OpenAI API Key Validation ✅

**Status**: RESOLVED on 2025-10-31

**Location**: `services/ai-worker/src/index.ts:52-56`

**Issue**: ai-worker could start without OPENAI_API_KEY, causing runtime failures during embedding generation.

**Resolution**: Added service-specific validation at ai-worker startup that fails fast with clear error message if OPENAI_API_KEY is missing.

### SQL Injection Risk in Memory Queries ✅

**Status**: RESOLVED on 2025-10-31

**Location**: `services/ai-worker/src/memory/PgvectorMemoryAdapter.ts:178`

**Issue**: Used `$queryRawUnsafe` with string interpolation for query construction.

**Resolution**: Converted to `Prisma.sql` tagged template literals with `Prisma.join()` for dynamic WHERE clauses.

### Distance Threshold Calculation Bug ✅

**Status**: RESOLVED on 2025-10-31

**Location**: `services/ai-worker/src/memory/PgvectorMemoryAdapter.ts:116-119`

**Issue**: Default minimum similarity was 0.15 (very low threshold) instead of 0.85 (high threshold).

**Resolution**:
- Changed default from 0.15 to 0.85
- Added comprehensive JSDoc documentation
- Clarified variable naming (minSimilarity, maxDistance)
- Documented pgvector cosine distance math

---

## How to Use This Document

1. **Adding New Items**:
   - Include location (file + line numbers)
   - Describe the issue and impact
   - Provide recommended fix
   - Add tracking information (date created, source)

2. **Prioritization**:
   - **Critical**: Security vulnerabilities, data loss risks, production blockers
   - **High**: Significant impact on maintainability, reliability, or performance
   - **Medium**: Moderate impact, should be addressed eventually
   - **Low**: Nice-to-have improvements, minimal impact

3. **Resolution**:
   - Move resolved items to "Completed / Resolved" section
   - Include resolution date and brief description of fix
   - Keep history for future reference

4. **Review Cadence**:
   - Review during sprint planning
   - Update priorities based on production impact
   - Archive resolved items older than 6 months
