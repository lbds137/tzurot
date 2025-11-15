# Retry Logic Consolidation & Job Chain Architecture

**Status**: Phase 1 & 2 Complete ✅
**Branch**: `feat/timeout-and-refactoring`
**Created**: 2025-11-15
**Completed**: 2025-11-15

## Problem Statement

### DRY Violations in Retry Logic

**Current State**: Three different retry implementations:
1. `retryService.ts` - Comprehensive, reusable utilities ✅
2. `LLMInvoker.invokeWithRetry()` - Custom retry loop (115 lines) ❌
3. `MultimodalProcessor.processAttachments()` - Custom parallel retry (70 lines) ❌

**Issues**:
- Code duplication makes maintenance harder
- Inconsistent retry counting (0-based vs 1-based)
- Each implementation has custom logging, timeout logic
- Hard to ensure consistent behavior across components

### Tight Timeout Budgets

**Current**: Components compete for shared timeout budget
- Audio processing: 90s
- LLM invocation: 105s (after subtracting audio time)
- **Result**: Intermittent timeout errors in production

**Desired**: Independent timeouts with generous limits
- Audio job: 120s (30s fetch + 60s Whisper + buffer)
- Image job: 60s (45s vision + buffer)
- LLM job: 600s (10 minutes for slow models + retries)

## Solution: Consolidate Retries + Job Chains

### Part 1: Standardize Retry Configuration

**Update `RETRY_CONFIG`**:
```typescript
export const RETRY_CONFIG = {
  /** Standard retry attempts for ALL components (1 initial + 2 retries = 3 total) */
  MAX_ATTEMPTS: 3,
  /** Initial delay before first retry (1 second) */
  INITIAL_DELAY_MS: 1000,
  /** Maximum delay between retries (10 seconds) */
  MAX_DELAY_MS: 10000,
  /** Backoff multiplier for exponential backoff */
  BACKOFF_MULTIPLIER: 2,

  // Component-specific timeouts (but same retry count!)
  /** Audio processing timeout (download + transcribe + buffer) */
  AUDIO_TIMEOUT: 120000,
  /** Image processing timeout (vision model + buffer) */
  IMAGE_TIMEOUT: 60000,
  /** LLM invocation global timeout (all attempts) */
  LLM_TIMEOUT: 600000,
} as const;
```

**Remove inconsistent configs**:
- ❌ `LLM_MAX_RETRIES: 2` (confusing - means 3 total attempts)
- ❌ `LLM_GLOBAL_TIMEOUT` in RETRY_CONFIG (move to TIMEOUTS)
- ✅ Use `MAX_ATTEMPTS: 3` everywhere

### Part 2: Refactor to Use `retryService`

#### LLMInvoker Refactoring

**Before** (115 lines of custom retry logic):
```typescript
async invokeWithRetry(...) {
  const maxRetries = RETRY_CONFIG.LLM_MAX_RETRIES;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Custom timeout tracking
    // Custom retry logic
    // Custom error handling
  }
}
```

**After** (using retryService):
```typescript
async invokeWithRetry(...) {
  return await withRetry(
    () => this.invokeSingleAttempt(model, messages, modelName),
    {
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      globalTimeoutMs: RETRY_CONFIG.LLM_TIMEOUT,
      logger,
      operationName: `LLM invocation (${modelName})`,
    }
  );
}

private async invokeSingleAttempt(...) {
  // Single attempt logic (timeout, validation, etc.)
}
```

**Benefits**:
- 115 lines → ~30 lines
- Consistent retry behavior
- Automatic exponential backoff
- Standardized logging

#### MultimodalProcessor Refactoring

**Before** (70 lines of custom parallel retry):
```typescript
async processAttachments(...) {
  const succeeded = [];
  let failedIndices = [...];
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    // Custom parallel processing
    // Custom failure tracking
    // Custom retry logic
  }
}
```

**After** (using withParallelRetry):
```typescript
async processAttachments(...) {
  const results = await withParallelRetry(
    attachments,
    (attachment) => this.processSingleAttachment(attachment, personality),
    {
      maxAttempts: RETRY_CONFIG.MAX_ATTEMPTS,
      logger,
      operationName: 'Attachment processing',
    }
  );

  return results.filter(r => r.status === 'success').map(r => r.value!);
}
```

**Benefits**:
- 70 lines → ~20 lines
- Reuses battle-tested logic
- Consistent with other components

### Part 3: Job Chain Architecture

#### Job Types

```typescript
enum JobType {
  // Preprocessing jobs (run first)
  AUDIO_TRANSCRIPTION = 'audio-transcription',
  IMAGE_DESCRIPTION = 'image-description',

  // Main job (depends on preprocessing)
  LLM_GENERATION = 'llm-generation',
}
```

#### Job Dependencies

```typescript
interface JobDependency {
  jobId: string;
  type: JobType;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
}

interface LLMJobData {
  // ... existing fields
  dependencies?: JobDependency[];
}
```

#### Flow Example

```
User sends: "What's in this image?" + audio.ogg + image.png
    ↓
api-gateway creates 3 jobs:
    ↓
    ├─→ [Job 1: AUDIO_TRANSCRIPTION] (120s timeout, 3 attempts)
    │   └─→ Result: { transcript: "..." } → Redis
    │
    ├─→ [Job 2: IMAGE_DESCRIPTION] (60s timeout, 3 attempts)
    │   └─→ Result: { description: "..." } → Redis
    │
    └─→ [Job 3: LLM_GENERATION] (600s timeout, 3 attempts)
        └─→ dependencies: [Job 1, Job 2]
        └─→ Waits for results from Redis
        └─→ Combines: message + transcript + description
        └─→ Generates response
```

#### Failure Scenarios & Graceful Degradation

The job chain architecture is designed for **graceful degradation** - preprocessing failures don't block the LLM response:

**Scenario 1: Individual Audio Job Fails**
```
User sends: "Transcribe these" + audio1.ogg + audio2.ogg
    ↓
Job 1 (audio1): ❌ Fails after 3 attempts (Whisper API timeout)
Job 2 (audio2): ✅ Succeeds → Redis: { transcript: "..." }
Job 3 (LLM): ⚠️ Proceeds with partial results
    └─→ Logs warning about missing audio1 result
    └─→ Uses transcript from audio2
    └─→ Generates response with available context
```

**Scenario 2: All Preprocessing Fails**
```
User sends: "What's this?" + corrupted.png
    ↓
Job 1 (image): ❌ Fails after 3 attempts (vision model error)
Job 2 (LLM): ⚠️ Proceeds without image description
    └─→ Logs warning about missing image result
    └─→ Responds based only on text message
    └─→ May inform user that image couldn't be processed
```

**Scenario 3: LLM Job Fails**
```
User sends: "Hello" + image.png
    ↓
Job 1 (image): ✅ Succeeds → Redis
Job 2 (LLM): ❌ Fails after 3 attempts (model timeout)
    └─→ bot-client receives failure via Redis pub/sub
    └─→ Sends error message to user
```

**Key Behaviors**:
- **No cascading failures**: Preprocessing failure doesn't block LLM
- **Individual retry budgets**: Each job retries independently (3 attempts)
- **Redis cleanup**: Job results expire after 1 hour (prevents memory leaks)
- **Clear logging**: Each component logs its own failures
- **User experience**: User gets response (possibly degraded) rather than total failure

**Dependency Resolution & Timing (BullMQ FlowProducer)**:
- **Flow Architecture**: Uses BullMQ FlowProducer for parent-child job relationships
  - **Parent Job**: LLM Generation (waits for all children to complete)
  - **Child Jobs**: Audio transcriptions + Image descriptions (run first, in parallel)
- **Guaranteed Order**: BullMQ FlowProducer ensures children ALWAYS complete before parent starts
  - Children run in parallel (audio + image processing happen simultaneously)
  - Parent (LLM) automatically queued AFTER all children complete
  - **No race conditions** - LLM never starts without preprocessing results
- **LLM Job Behavior**: When LLM job starts processing:
  - All child jobs have completed (guaranteed by FlowProducer)
  - Retrieves results from Redis for all dependencies
  - If child failed → result missing in Redis → logs warning, continues with graceful degradation
- **Graceful Degradation**: Individual child failures don't block LLM response
  - Audio transcription fails → LLM proceeds with images only
  - Image description fails → LLM proceeds with audio only
  - All preprocessing fails → LLM proceeds with text message only
- **Timeout**: Railway worker timeout = none (jobs can run indefinitely)
  - Component-level timeouts enforced (audio: 180s, image: 90s, LLM: 480s)
- **Benefits**:
  - ✅ No polling/waiting logic needed - BullMQ handles dependencies
  - ✅ Parallel preprocessing for better performance
  - ✅ Guaranteed execution order
  - ✅ Built-in retry support for each job

#### Implementation Steps

1. **Create preprocessor jobs** (`AudioTranscriptionJob`, `ImageDescriptionJob`)
   - Extract logic from MultimodalProcessor
   - Use retryService for consistency
   - Publish results to Redis with predictable keys

2. **Update LLM job** to check for dependencies
   - Check Redis for preprocessing results before starting
   - Combine results into context
   - Continue with LLM invocation

3. **api-gateway orchestration**
   - Detect attachments in request
   - Create preprocessing jobs first
   - Create LLM job with dependencies
   - Return requestId to bot-client

4. **bot-client job tracking**
   - Already handles async results via JobTracker ✅
   - No changes needed!

### Part 4: Generous Timeout Allocation

With independent jobs, each component gets full timeout:

```typescript
// OLD (shared budget):
Total: 300s
  - Audio: 90s
  - LLM: 105s (300 - 90 - 90 - 15)
  → LLM can't complete 3 attempts!

// NEW (independent budgets):
Audio Job: 120s × 3 attempts = up to 360s
Image Job: 60s × 3 attempts = up to 180s
LLM Job: 600s × 3 attempts = up to 1800s (30 min max!)

Each job has its own Railway worker timeout (no limit!)
```

**Benefits**:
- **Much more forgiving** for slow models/APIs
- **Proper retry support** - each component can retry fully
- **Better user experience** - fewer timeout errors
- **Clearer failures** - know exactly which component failed

## Testing Strategy

### Unit Tests

1. **Retry standardization**:
   - Verify all components use MAX_ATTEMPTS: 3
   - Test retry count consistency
   - Verify exponential backoff

2. **retryService integration**:
   - Mock LLM/vision/Whisper APIs
   - Test transient failures retry properly
   - Test permanent failures fail after 3 attempts
   - Test timeout behavior

3. **Job chain**:
   - Test dependency resolution
   - Test parallel preprocessing
   - Test LLM waits for results
   - Test failure handling

### Integration Tests

1. Create test jobs with actual attachments
2. Verify preprocessing completes before LLM
3. Test retry scenarios
4. Measure actual timing vs timeouts

### Production Monitoring

1. Log component-level timing
2. Track retry rates per component
3. Alert on timeout trends
4. Adjust timeouts based on P95/P99 data

## Migration Plan

### Phase 1: Consolidate Retry Logic ✅ COMPLETE
- [x] Create refactoring plan (this document)
- [x] Standardize RETRY_CONFIG (MAX_ATTEMPTS: 3 everywhere)
- [x] Refactor LLMInvoker to use withRetry
- [x] Refactor MultimodalProcessor to use withParallelRetry
- [x] Update all tests
- [x] Ready to deploy to dev

### Phase 2: Job Chain Architecture ✅ COMPLETE
- [x] Design job dependency system
- [x] Create AudioTranscriptionJob
- [x] Create ImageDescriptionJob
- [x] Update LLMGenerationJob to check dependencies
- [x] Update api-gateway job creation
- [x] Update tests
- [x] Ready to deploy to dev

### Phase 3: Optimize Timeouts (Future PR)
- [ ] Collect production timing data
- [ ] Adjust timeouts based on P95/P99
- [ ] Test with slow models
- [ ] Fine-tune retry delays

## Success Criteria

- [x] All retry logic uses retryService utilities (DRY)
- [x] All components use MAX_ATTEMPTS: 3 (consistent)
- [x] Audio/image processing in separate jobs
- [x] Job chain architecture implemented
- [x] All tests passing (640 tests)
- [ ] Each job has independent timeouts (PENDING - see timeout-architecture-refactor.md)
- [ ] No timeout errors in dev for 48 hours (PENDING - deployment)
- [ ] User-facing latency unchanged or improved (PENDING - deployment)

**Additional Achievements**:
- [x] Type system cleaned up (removed JobResult duplication)
- [x] Consolidated duplicate types using Zod schemas (DRY)
- [x] Production bug fixes (defensive coding for invalid results)
- [x] Backward compatibility cleanup

## Files to Modify

### Phase 1 (Retry Consolidation)
- `packages/common-types/src/constants/timing.ts` - Standardize RETRY_CONFIG
- `services/ai-worker/src/services/LLMInvoker.ts` - Use withRetry
- `services/ai-worker/src/services/MultimodalProcessor.ts` - Use withParallelRetry
- All related test files

### Phase 2 (Job Chains)
- `packages/common-types/src/types/jobs.ts` - Add new job types
- `services/ai-worker/src/jobs/AudioTranscriptionJob.ts` - New
- `services/ai-worker/src/jobs/ImageDescriptionJob.ts` - New
- `services/ai-worker/src/jobs/AIJobProcessor.ts` - Handle dependencies
- `services/api-gateway/src/routes/ai.ts` - Create multiple jobs
- Related test files

## References

- **Issue**: Intermittent timeout errors in production
- **Root Cause**: DRY violations + tight shared timeout budget
- **Related Docs**: `timeout-architecture-refactor.md`
