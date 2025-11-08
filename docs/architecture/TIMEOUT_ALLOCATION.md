# Timeout Allocation Strategy

**Last Updated**: 2025-11-08
**Related PR**: #225

## Overview

Tzurot runs on Railway with a hard 5-minute (300s) HTTP timeout limit. This document explains how we allocate that timeout budget across attachment processing, LLM inference, and system operations.

## Railway Constraints

**Railway Timeout**: 300 seconds (5 minutes)
- This is a **hard limit** enforced by Railway's infrastructure
- HTTP connection stays open for the entire request duration
- If we exceed this, Railway terminates the request immediately
- The bot's Discord response will fail

**Our Safety Buffer**: We cap job timeouts at 270s (4.5 minutes)
- Leaves 30s buffer for Railway overhead and safety margin
- Defined as `TIMEOUTS.JOB_WAIT = 270000` in `constants/timing.ts`

## Parallel vs Sequential Processing

### The Critical Distinction

**WRONG (Sequential Model)**:
```
5 images = 5 × 45s = 225s
❌ Assumes images process one at a time
```

**CORRECT (Parallel Model)**:
```
5 images = 45s + 45s retry = 90s
✅ All images process simultaneously (Promise.allSettled)
```

### Why This Matters

The old sequential assumption wasted Railway's timeout budget:
- **Before**: 5 images allocated 225s → only 45s left for LLM
- **After**: 5 images allocated 90s → 165s left for LLM

This was a **critical bug** causing timeouts with slow models.

## Timeout Budget Breakdown

### Formula

```typescript
jobTimeout = JOB_BASE + attachmentBatch + retryBuffer
           ↓
llmTimeout = jobTimeout - attachmentBatch - retryBuffer - systemOverhead
```

### Components

**1. JOB_BASE (120s)**
- Baseline for jobs with no attachments
- Covers memory retrieval, history loading, basic processing

**2. Attachment Batch Time**
- **Images**: `VISION_MODEL = 45s`
- **Audio**: `AUDIO_FETCH + WHISPER_API = 60s + 90s = 150s`
- **Mixed**: Takes the slowest (audio wins at 150s)

**3. Retry Buffer**
- **Formula**: `slowestBatchTime × 1`
- **Rationale**: Most requests succeed first try, so we only budget for ONE retry
- **Example**: Images need 45s × 1 = 45s retry buffer

**4. System Overhead (15s)**
- Memory retrieval from pgvector
- Database queries (history, user data)
- Queue operations (BullMQ)
- Network latency

## Calculation Examples

### No Attachments
```
Job timeout:  120s (JOB_BASE)
LLM timeout:  120s - 0 - 0 - 15s = 105s
Total:        120s ✅ Well under Railway limit
```

### Single Image
```
Job timeout:  120s + 45s + 45s = 210s
LLM timeout:  210s - 45s - 45s - 15s = 105s
Total:        210s ✅ Safe
```

### Five Images (Parallel)
```
Job timeout:  120s + 45s + 45s = 210s
LLM timeout:  210s - 45s - 45s - 15s = 105s
Total:        210s ✅ Same as single image!
```

### Single Audio (Voice Message)
```
Job timeout:  120s + 150s + 150s = 420s → CAPPED at 270s
LLM timeout:  270s - 150s - 150s - 15s = -45s → MIN 60s
Total:        270s ✅ At Railway cap
```

### Audio + Images (Mixed)
```
Job timeout:  120s + 150s + 150s = 420s → CAPPED at 270s
              (audio wins, images ignored)
LLM timeout:  270s - 150s - 150s - 15s = -45s → MIN 60s
Total:        270s ✅ At Railway cap
```

## Timeout Constants Reference

### Attachment Processing (`constants/timing.ts`)

```typescript
export const TIMEOUTS = {
  /** Vision model invocation (45s - parallel batch processing) */
  VISION_MODEL: 45000,

  /** Audio file download (60s) */
  AUDIO_FETCH: 60000,

  /** Whisper transcription (90s - realistic for voice messages) */
  WHISPER_API: 90000,

  /** System overhead (15s - memory, DB, queue, network) */
  SYSTEM_OVERHEAD: 15000,

  /** Job wait timeout (270s - Railway safety buffer) */
  JOB_WAIT: 270000,

  /** Base timeout for jobs (120s - minimum for any job) */
  JOB_BASE: 120000,

  /** LLM API call timeout per attempt (90s - for slow models) */
  LLM_API: 90000,
}
```

### Retry Configuration

```typescript
export const RETRY_CONFIG = {
  /** Maximum retry attempts for transient errors (3) */
  MAX_ATTEMPTS: 3,

  /** Initial delay before first retry (1s) */
  INITIAL_DELAY_MS: 1000,

  /** Maximum delay between retries (10s) */
  MAX_DELAY_MS: 10000,
}
```

## Implementation

### calculateJobTimeout()

**Location**: `packages/common-types/src/utils/timeout.ts`

```typescript
export function calculateJobTimeout(imageCount: number, audioCount: number = 0): number {
  let timeout = TIMEOUTS.JOB_BASE; // 120s

  if (imageCount > 0 || audioCount > 0) {
    // One parallel batch (slowest wins)
    const imageBatchTime = imageCount > 0 ? TIMEOUTS.VISION_MODEL : 0;
    const audioBatchTime = audioCount > 0
      ? TIMEOUTS.AUDIO_FETCH + TIMEOUTS.WHISPER_API
      : 0;
    const slowestBatchTime = Math.max(imageBatchTime, audioBatchTime);

    // Account for ONE retry in worst case
    const retryBuffer = slowestBatchTime * 1;

    timeout = TIMEOUTS.JOB_BASE + slowestBatchTime + retryBuffer;
  }

  // Cap at Railway limit minus buffer
  return Math.min(timeout, TIMEOUTS.JOB_WAIT); // 270s max
}
```

### calculateLLMTimeout()

**Location**: `packages/common-types/src/utils/timeout.ts`

```typescript
export function calculateLLMTimeout(
  jobTimeout: number,
  imageCount: number,
  audioCount: number
): number {
  // Estimate attachment processing time (parallel)
  const imageBatchTime = imageCount > 0 ? TIMEOUTS.VISION_MODEL : 0;
  const audioBatchTime = audioCount > 0
    ? TIMEOUTS.AUDIO_FETCH + TIMEOUTS.WHISPER_API
    : 0;
  const slowestBatchTime = Math.max(imageBatchTime, audioBatchTime);

  // Retry buffer for ONE retry
  const retryBuffer = slowestBatchTime > 0 ? slowestBatchTime * 1 : 0;
  const systemOverhead = TIMEOUTS.SYSTEM_OVERHEAD;

  // Calculate available time for LLM
  const calculatedTimeout = jobTimeout - slowestBatchTime - retryBuffer - systemOverhead;

  // Warn if budget is very tight
  if (calculatedTimeout < 60000 && (imageCount > 0 || audioCount > 0)) {
    logger.warn('[TimeoutCalculator] Job timeout budget is very tight for attachments + LLM');
  }

  // LLM gets the rest (minimum 60s for slow models)
  return Math.max(60000, calculatedTimeout);
}
```

## Tuning Guidelines

### When to Adjust Timeouts

Monitor these metrics in production:

**1. Whisper Timeout Rate**
- **Current**: 90s
- **Watch for**: >5% of audio requests timing out
- **Action**: Increase to 120-150s if needed
- **Why**: Long voice messages (>3 minutes) might need more time

**2. Vision Model Retry Rate**
- **Current**: 45s per attempt
- **Watch for**: >20% of image requests requiring retries
- **Action**: Increase to 60s or add retry buffer multiplier
- **Why**: Slow vision models or rate limits

**3. LLM Timeout Rate**
- **Current**: 60s minimum, dynamic allocation
- **Watch for**: >1% of requests timing out
- **Action**: Increase minimum to 90s or reduce attachment timeouts
- **Why**: Very slow models or large context windows

### How to Tune

**1. Increase WHISPER_API timeout**:
```typescript
// In constants/timing.ts
WHISPER_API: 120000, // 120s instead of 90s
```

**2. Increase retry buffer**:
```typescript
// In timeout.ts
const retryBuffer = slowestBatchTime * 1.5; // 1.5× instead of 1×
```

**3. Increase LLM minimum**:
```typescript
// In timeout.ts
return Math.max(90000, calculatedTimeout); // 90s instead of 60s
```

**Important**: Any timeout increase reduces time available for other operations. Always consider the Railway 270s budget.

## Common Timeout Scenarios

### Scenario 1: Text-Only Message
```
Attachment time: 0s
Retry buffer:    0s
System overhead: 15s
LLM available:   105s (120s - 15s)
Total job:       120s
```
**Result**: ✅ LLM has plenty of time

### Scenario 2: Message with 3 Images
```
Attachment time: 45s (all parallel)
Retry buffer:    45s
System overhead: 15s
LLM available:   105s (210s - 45s - 45s - 15s)
Total job:       210s
```
**Result**: ✅ LLM still has good time allocation

### Scenario 3: Voice Message (2 minutes)
```
Attachment time: 150s (60s download + 90s transcribe)
Retry buffer:    150s
System overhead: 15s
LLM available:   60s (270s - 150s - 150s - 15s, minimum enforced)
Total job:       270s (capped)
```
**Result**: ⚠️ Tight but workable

### Scenario 4: Long Voice Message (4+ minutes)
```
Attachment time: 180s+ (60s download + 120s+ transcribe)
Retry buffer:    180s+
System overhead: 15s
LLM available:   60s (minimum enforced)
Total job:       270s (capped, may timeout)
```
**Result**: ⚠️ May timeout during transcription - monitor logs

## Troubleshooting

### "Job exceeded Railway timeout"

**Symptoms**: Jobs fail at exactly 270s with timeout error

**Likely Causes**:
1. Audio file transcription took too long
2. Vision model API was slow
3. LLM took longer than allocated time

**Debug Steps**:
1. Check logs for which step timed out
2. Look at attachment count (multiple audio files?)
3. Check if model was slow (model name in logs)
4. Verify retry rates (lots of retries?)

**Solutions**:
- Reduce attachment processing timeouts slightly
- Increase retry buffer if retry rate is high
- Use faster models for large attachment batches

### "LLM invocation timed out"

**Symptoms**: LLM throws timeout error before response completes

**Likely Causes**:
1. Slow model with large context
2. Not enough time allocated after attachments
3. Network issues causing retries

**Debug Steps**:
1. Check calculated LLM timeout in logs
2. Verify attachment count and types
3. Check if minimum (60s) was enforced
4. Look for retry attempts

**Solutions**:
- Increase LLM minimum timeout to 90s
- Reduce attachment retry buffer
- Use faster models for large batches

### "Attachment processing failed"

**Symptoms**: Vision or Whisper API times out

**Likely Causes**:
1. Large/complex images taking >45s
2. Long audio files taking >90s
3. API rate limits causing delays

**Debug Steps**:
1. Check attachment sizes in logs
2. Look for API error messages
3. Verify retry attempts and delays

**Solutions**:
- Increase VISION_MODEL or WHISPER_API timeout
- Implement progressive retry backoff
- Add size limits for attachments

## Related Documentation

- **[Testing Guide](../guides/TESTING.md)** - How to test timeout behavior
- **[Deployment Guide](../deployment/DEPLOYMENT.md)** - Railway configuration
- **[Architecture Decisions](./ARCHITECTURE_DECISIONS.md)** - Why we chose these patterns
- **PR #225** - Implementation details and rationale

## Changelog

### 2025-11-08 - Initial Version (PR #225)
- Fixed parallel processing assumption
- Reduced retry buffer from 2× to 1×
- Added AUDIO_FETCH to audio timeout calculation
- Reduced LLM minimum from 120s to 60s
- Added dynamic LLM timeout allocation
- Documented Railway constraints and allocation strategy
