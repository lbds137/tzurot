# Timeout Architecture Refactoring

> **Status**: Phase 1 COMPLETE ✅ — Phase 2-3 DEFERRED (future optimization)
> **Branch**: `feat/timeout-and-refactoring`
> **Created**: 2025-11-15
> **Phase 1 Completed**: 2025-11-15
> **Updated**: 2026-01-17

**Phase 1 COMPLETE**: Timeout calculations now use independent component budgets.
Each component gets its own timeout that doesn't compete with others.

**Phase 2-3 (Deferred)**: Extract component-specific timeouts, fully async processing. Low priority - current architecture is sufficient.

## Problem Statement

Current timeout architecture treats all job components as **sequential**, subtracting each component's time from the total budget. This creates two major issues:

### Issue 1: Insufficient Retry Budget

**Current calculation (with audio)**:

```
Job Timeout:  120s (base) + 90s (audio) + 90s (retry) = 300s
LLM Timeout:  300s - 90s (audio) - 90s (retry) - 15s (overhead) = 105s
```

**Problem**: If LLM takes 105s on first attempt and times out, there's no time left for retries despite allowing `LLM_MAX_RETRIES = 2`.

### Issue 2: Components Competing for Time Budget

Audio processing and LLM invocation are **independent operations** that could/should have separate timeouts. Currently, audio time is subtracted from LLM budget even though they don't directly compete for resources.

## Current Architecture

```
ai-worker job:
  1. Process attachments (audio: 30s fetch + 60s transcribe = 90s)
  2. Build context with processed attachments
  3. Invoke LLM (105s remaining from 300s job budget)
```

**Timeout Calculation**:

```typescript
// calculateJobTimeout()
timeout = JOB_BASE + slowestBatchTime + retryBuffer;

// calculateLLMTimeout()
llmTimeout = jobTimeout - slowestBatchTime - retryBuffer - overhead;
```

**The flaw**: LLM gets the "leftovers" after subtracting attachment time.

## Proposed Architecture: Independent Component Timeouts

### Core Principle

Each pipeline component gets its **own independent timeout**, not competing for a shared budget. The job timeout should be the **sum** (or max) of component timeouts, not a zero-sum allocation.

### New Timeout Model

```
ai-worker job components (running sequentially but with independent timeouts):
  1. Audio Processing:     90s max (AUDIO_FETCH + WHISPER_API)
  2. Image Processing:     45s max (VISION_MODEL)
  3. LLM Invocation:      480s max (LLM_GLOBAL_TIMEOUT)
  4. System Overhead:      15s (DB, queue, network)

Total Job Timeout = MAX(audio, image) + LLM + overhead
                  = 90s + 480s + 15s
                  = 585s (~10 minutes)
```

### Timeout Constants Refactoring

**Before**:

```typescript
TIMEOUTS.LLM_API: 180000           // Per-attempt (3 min)
RETRY_CONFIG.LLM_GLOBAL_TIMEOUT: 480000  // Misplaced in RETRY_CONFIG
TIMEOUTS.JOB_WAIT: 600000         // Gateway timeout
```

**After**:

```typescript
// Component-level timeouts (independent)
TIMEOUTS.AUDIO_PROCESSING: 90000   // AUDIO_FETCH + WHISPER_API
TIMEOUTS.IMAGE_PROCESSING: 45000   // VISION_MODEL
TIMEOUTS.LLM_INVOCATION: 480000    // Total for all retry attempts
TIMEOUTS.LLM_PER_ATTEMPT: 180000   // Max per single attempt
TIMEOUTS.SYSTEM_OVERHEAD: 15000    // DB, queue, network

// Gateway timeout (must exceed sum of all components)
TIMEOUTS.JOB_WAIT: 600000          // 10 minutes (Railway safety buffer)
```

### New Calculation Logic

```typescript
/**
 * Calculate job timeout as SUM of independent component timeouts
 */
export function calculateJobTimeout(imageCount: number, audioCount: number): number {
  let timeout = TIMEOUTS.SYSTEM_OVERHEAD;

  // Add attachment processing time (components run in parallel, use slowest)
  const attachmentTime = Math.max(
    imageCount > 0 ? TIMEOUTS.IMAGE_PROCESSING : 0,
    audioCount > 0 ? TIMEOUTS.AUDIO_PROCESSING : 0
  );

  // Add LLM invocation time (independent of attachment processing)
  timeout += attachmentTime + TIMEOUTS.LLM_INVOCATION;

  // Cap at Railway limit
  return Math.min(timeout, TIMEOUTS.JOB_WAIT);
}

/**
 * REMOVED: calculateLLMTimeout() function
 *
 * Previously planned to simplify this function to just return TIMEOUTS.LLM_INVOCATION,
 * but ultimately removed it entirely for better simplicity.
 *
 * Code now uses TIMEOUTS.LLM_INVOCATION constant directly where needed.
 */
```

## Benefits

### 1. Predictable Component Timeouts

- Audio always gets 90s, regardless of LLM or image count
- LLM always gets 480s (8 minutes) for retries
- No components stealing time from each other

### 2. Proper Retry Support

- 480s LLM budget allows 3 attempts at 180s each (540s max, capped at 480s)
- First attempt timeout → 300s remaining for 2 retries
- Much more forgiving for slow models

### 3. Simpler Mental Model

- Job timeout = sum of component timeouts
- Each component is independent
- Easy to reason about and debug

### 4. Future-Proof for Async Components

If we later make audio processing fully async (separate job):

- Audio job: 90s timeout
- LLM job: 480s timeout
- They run in parallel, each with full time budget

## Implementation Plan

**Current State**: ✅ COMPLETE

- ✅ Constants updated (TIMEOUTS.LLM_INVOCATION, VISION_MODEL, WHISPER_API, AUDIO_FETCH)
- ✅ Timeout calculation functions use NEW independent budget model
- ✅ All tests updated and passing (644 tests)

### Phase 1: Refactor Timeout Calculation ✅ COMPLETE

- [x] Move `LLM_GLOBAL_TIMEOUT` to `TIMEOUTS.LLM_INVOCATION`
- [x] Individual component timeouts defined (VISION_MODEL, WHISPER_API, AUDIO_FETCH)
- [x] Rewrite `calculateJobTimeout()` to sum independent timeouts
- [x] Simplify `calculateLLMTimeout()` to return constant TIMEOUTS.LLM_INVOCATION
- [x] Update all timeout tests in packages/common-types/src/utils/timeout.test.ts
- [x] All 644 tests passing

### Phase 2: Extract Component Timeouts (Future)

- [ ] Create `AudioProcessor` class with 90s timeout
- [ ] Create `ImageProcessor` class with 45s timeout
- [ ] Each processor handles its own timeout and retries
- [ ] Main job orchestrates but doesn't manage timeouts

### Phase 3: Fully Async Processing (Future)

- [ ] Audio processing as separate BullMQ job
- [ ] Results combined via Redis/job tracker
- [ ] True parallel processing

## Testing Strategy

### Unit Tests

- Update `timeout.test.ts` with new calculation logic
- Verify LLM always gets full 480s budget
- Verify job timeout = sum of components

### Integration Tests

- Test with various combinations of attachments
- Verify actual timeouts in logs match expectations
- Test retry scenarios with slow models

### Production Monitoring

- Log component-level timing telemetry
- Alert if any component consistently hitting timeout
- Adjust constants based on real-world data

## Success Criteria

- [x] LLM always gets full 480s budget (independent of attachments)
- [x] Timeout calculations use additive model (not zero-sum)
- [x] All tests passing (644 tests)
- [x] TypeScript builds successfully
- [ ] No intermittent timeout errors in production (PENDING - needs deployment)
- [ ] Deployed to dev and tested for 24 hours (PENDING - deployment)

## References

- **Issue**: Intermittent timeout errors in production (alpha.37)
- **Root Cause**: Sequential timeout budget model
- **Related**: Async job delivery architecture (already supports parallel processing)
