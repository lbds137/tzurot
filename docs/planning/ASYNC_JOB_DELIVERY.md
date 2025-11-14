# Async Job Delivery Architecture

**Status**: In Progress
**Branch**: `feat/async-job-delivery`
**Created**: 2025-11-14
**Target**: v3.0.0-alpha.36+

## Problem Statement

Current architecture uses synchronous HTTP request/response pattern for AI jobs, artificially constraining all operations to Railway's 270s (4.5 minute) timeout. This causes:

- Frequent timeouts with long audio transcriptions (4+ minutes of audio)
- Timeouts with slow LLM models on complex context
- Artificial complexity in timeout budget calculations
- No room for retries without eating into LLM time
- Poor scalability

**Root Cause**: We treat Railway's 5-minute HTTP timeout as a constraint on the entire job lifecycle, when it should only constrain individual HTTP request/response cycles.

**Current Flow**:
```
bot-client → HTTP POST (wait=true) → api-gateway (waitUntilFinished 270s) → ai-worker
         ↑__________________ Connection stays open ⏰ _____________________↓
```

## Solution: Async Job Pattern with Redis Streams

Move from synchronous request/response to async job pattern using Redis Streams for result delivery.

**New Flow**:
```
bot-client → HTTP POST → api-gateway → 202 Accepted + jobId (<50ms)
                              ↓
                         BullMQ queue
                              ↓
bot-client subscribes to Redis Stream 'job-results'
    - Maintains typing indicator
    - Waits for result (no timeout!)
                              ↓
ai-worker processes job (NO TIME CONSTRAINTS!)
    - Download attachments
    - Transcribe audio (take hours if needed!)
    - Process images
    - Retrieve memory
    - LLM inference (slowest model? no problem!)
    - Store result in database
    - Publish result to Redis Stream 'job-results'
                              ↓
bot-client receives result → stops typing → sends Discord message → confirms delivery
                              ↓
ai-worker marks result as DELIVERED → cleanup after 24h
```

## Key Benefits

1. **No Time Constraints**: Jobs can run for 10+ minutes, even hours if needed
2. **Better Reliability**: Results persisted until confirmed delivered
3. **Simpler Code**: No complex timeout budget calculations
4. **Real-Time Delivery**: Results delivered instantly via Redis Stream
5. **Scalable**: Multiple bot-client instances can subscribe
6. **Better UX**: Optional progress updates during long operations

## Architecture Changes

### 1. bot-client (Major Changes)

**Add Redis Stream Subscriber**:
- Subscribe to `job-results` stream on startup
- Use consumer group for multiple bot instances
- Listen for results matching tracked job IDs

**Job Tracking**:
```typescript
class JobTracker {
  private activeJobs = new Map<string, {
    channelId: string;
    typingInterval: NodeJS.Timeout;
    startTime: number;
  }>();

  trackJob(jobId: string, channelId: string): void {
    // Start typing indicator loop
    const typingInterval = setInterval(() => {
      channel.sendTyping();
    }, 8000);

    this.activeJobs.set(jobId, { channelId, typingInterval, startTime: Date.now() });
  }

  completeJob(jobId: string, result: JobResult): void {
    const job = this.activeJobs.get(jobId);
    if (!job) return;

    clearInterval(job.typingInterval);
    this.activeJobs.delete(jobId);

    // Send result to Discord
    // Confirm delivery to gateway
  }
}
```

**Remove Synchronous Waits**:
- Remove `wait=true` from all HTTP requests
- Remove timeout logic from GatewayClient
- Simplify to just: send job, get jobId, track it

### 2. api-gateway (Simplification!)

**Always Return Immediately**:
- Remove all `waitForCompletion` logic
- Remove `job.waitUntilFinished()` calls
- Always return `202 Accepted` with jobId
- HTTP request completes in <50ms

**New Route for Delivery Confirmation**:
```typescript
POST /jobs/:jobId/confirm-delivery
{
  "deliveredAt": "2025-11-14T12:34:56.789Z"
}
```

### 3. ai-worker (Liberation!)

**Remove Timeout Constraints**:
- Remove JOB_WAIT capping from timeout calculations
- Remove artificial timeout minimums
- Let each operation take as long as needed
- Simplify retry logic (no rush!)

**Result Publishing**:
```typescript
async completeJob(job: Job, result: JobResult): Promise<void> {
  // 1. Store result in database
  await db.jobResults.create({
    jobId: job.id,
    requestId: result.requestId,
    result: result,
    status: 'PENDING_DELIVERY',
    completedAt: new Date(),
  });

  // 2. Publish to Redis Stream
  await redis.xadd(
    'job-results',
    '*',
    'jobId', job.id,
    'result', JSON.stringify(result)
  );

  logger.info(`[AIWorker] Published result for job ${job.id} to Redis Stream`);
}
```

**Progress Updates** (Optional Phase 2):
```typescript
// During processing
await job.updateProgress({
  stage: 'transcribing',
  percent: 50,
  message: 'Transcribing audio...'
});
```

### 4. Database Schema

**New Table: `job_results`**:
```sql
CREATE TABLE job_results (
  job_id VARCHAR(255) PRIMARY KEY,
  request_id VARCHAR(255) NOT NULL,
  result JSONB NOT NULL,
  status VARCHAR(50) NOT NULL, -- PENDING_DELIVERY, DELIVERED
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  delivered_at TIMESTAMP,
  INDEX idx_status_completed (status, completed_at)
);
```

**Cleanup Job**:
- Delete results with `status = 'DELIVERED'` AND `delivered_at < NOW() - INTERVAL '24 hours'`
- Run every hour via cron or separate cleanup service

**DB Sync Exclusion**:
- This table contains **ephemeral operational data** (results deleted after 24h)
- Should be **excluded from db-sync** (when implemented)
- Similar to BullMQ Redis data - not user data, just operational state

## Implementation Phases

### Phase 1: Core Async Infrastructure ✅ **[IN PROGRESS]**

**Goal**: Decouple job submission from result delivery

**Implementation Tasks**:
1. ✅ Create planning document
2. ✅ Add `job_results` table (Prisma migration)
3. ✅ Add Redis Stream publisher to ai-worker
4. ⏳ Add Redis Stream subscriber to bot-client
5. ⏳ Update api-gateway to return 202 immediately
6. ⏳ Add delivery confirmation endpoint to api-gateway
7. ⏳ Update bot-client to track jobs and confirm delivery
8. ⏳ Wire up all components in bot-client main

**Testing Tasks** (Before Merge!):
1. ⏳ Unit tests for ResultsListener
2. ⏳ Unit tests for JobTracker
3. ⏳ Unit tests for Redis Stream publisher (ai-worker)
4. ⏳ Unit tests for delivery confirmation endpoint
5. ⏳ Integration test: Full async job flow (submit → process → deliver)
6. ⏳ Integration test: Job failure handling
7. ⏳ Integration test: Bot restart during pending job
8. ⏳ Manual testing in dev environment

**Success Criteria**:
- Jobs complete successfully regardless of duration
- Results delivered via Redis Stream
- No more timeout errors in production
- **All tests passing (unit + integration)**
- **No regression in existing functionality**

### Phase 2: Remove Timeout Constraints

**Goal**: Eliminate artificial timeout limitations

**Tasks**:
1. Remove JOB_WAIT capping from `calculateJobTimeout()`
2. Remove timeout minimums from `calculateLLMTimeout()`
3. Simplify timeout allocation (no more budget calculations!)
4. Update timeout documentation
5. Test with intentionally slow operations (4+ minute audio)

**Success Criteria**:
- Long audio files (10+ minutes) transcribe successfully
- Slow LLM models complete without timeout
- Simpler, cleaner timeout code

### Phase 3: Reliability Enhancements

**Goal**: Ensure no results are lost

**Tasks**:
1. Add database persistence for all results
2. Add delivery confirmation flow
3. Add cleanup job for old results
4. Add retry logic for failed deliveries
5. Add monitoring for stuck jobs

**Success Criteria**:
- Zero lost results
- Automatic cleanup of old data
- Visibility into pending deliveries

### Phase 4: UX Enhancements (Optional)

**Goal**: Better user experience during long operations

**Tasks**:
1. Interactive status messages (edit message with progress)
2. Progress updates via `job.updateProgress()`
3. Status updater service subscribes to progress events
4. Resumable job cache (intermediate results)

**Success Criteria**:
- Users see real-time progress
- Long waits feel interactive
- Failed jobs resume from last checkpoint

## Migration Strategy

### For Existing Code

**bot-client/src/utils/GatewayClient.ts**:
- Keep old `generate()` method temporarily
- Add new `generateAsync()` method
- Migrate callers one by one
- Remove old method once all migrated

**api-gateway/src/routes/ai.ts**:
- Keep `wait=true` support temporarily for backward compatibility
- Default to async pattern (`wait=false` or no param)
- Remove sync support after bot-client fully migrated

### Testing During Migration

1. Feature flag: `ENABLE_ASYNC_JOBS=true|false`
2. Run both patterns in parallel initially
3. Compare results, validate correctness
4. Switch fully to async once confident

## Redis Stream Details

### Stream Structure

**Stream Name**: `job-results`

**Message Format**:
```json
{
  "jobId": "gen:abc-123",
  "requestId": "abc-123",
  "result": {
    "content": "...",
    "metadata": { ... }
  },
  "completedAt": "2025-11-14T12:34:56.789Z"
}
```

### Consumer Group

**Group Name**: `bot-client-results`

**Benefits**:
- Multiple bot-client instances can consume same stream
- Each result delivered to only one consumer
- Automatic retry if consumer crashes
- Persistent checkpoint of last processed message

### Error Handling

**Failed Delivery**:
1. Result stays in database with `PENDING_DELIVERY`
2. Cleanup job checks for old pending results
3. Re-publishes to stream if delivery failed
4. Eventually marks as failed after N retries

## Monitoring & Observability

### Metrics to Track

1. **Job Duration**: How long jobs actually take (no more artificial cap!)
2. **Delivery Latency**: Time from completion to Discord message
3. **Pending Results**: Count of `PENDING_DELIVERY` results
4. **Stream Lag**: Consumer group lag on `job-results` stream
5. **Timeout Rate**: Should drop to near-zero

### Logging

**ai-worker**:
```typescript
logger.info({
  jobId,
  duration: Date.now() - startTime,
  audioSeconds: context.audioDuration,
  imageCount: context.images.length,
}, 'Job completed (no time limit!)');
```

**bot-client**:
```typescript
logger.info({
  jobId,
  deliveryLatency: Date.now() - job.completedAt,
  waitTime: Date.now() - job.startTime,
}, 'Result delivered to Discord');
```

## Rollback Plan

### If Things Go Wrong

1. **Feature Flag**: Set `ENABLE_ASYNC_JOBS=false`
2. **Revert Bot Client**: Switch back to synchronous pattern
3. **Database**: `job_results` table can stay (unused but harmless)
4. **Redis Stream**: Will accumulate unread messages but won't break anything

### Clean Rollback Steps

```bash
# Disable async pattern
railway variables set ENABLE_ASYNC_JOBS=false

# Redeploy bot-client with sync pattern
git revert <async-commits>
git push
```

## Future Enhancements

### Beyond This PR

1. **WebSocket Support**: Real-time progress for web dashboard
2. **Job Prioritization**: VIP users get faster processing
3. **Partial Results**: Stream LLM tokens as they generate
4. **Job Cancellation**: User can cancel long-running jobs
5. **Result Caching**: Identical requests return cached results

## Success Metrics

### How We'll Know This Worked

**Before**:
- ~5% timeout rate with audio messages
- ~2% timeout rate with slow LLM models
- Complex timeout budget calculations
- Frustrated users waiting for "something went wrong"

**After**:
- ~0% timeout rate (maybe network failures, but not our constraints)
- Simpler codebase (no timeout budget math)
- Happy users (even 10-minute jobs complete successfully)
- Scalable architecture for future growth

## Related Documentation

- [TIMEOUT_ALLOCATION.md](../architecture/TIMEOUT_ALLOCATION.md) - Current timeout strategy (will be simplified)
- [ARCHITECTURE_DECISIONS.md](../architecture/ARCHITECTURE_DECISIONS.md) - Why microservices
- [Gemini Brainstorm Session](https://github.com/lbds137/tzurot/issues/XXX) - Original async pattern discussion

## Changelog

### 2025-11-14 - Initial Planning
- Created planning document
- Defined phases and success criteria
- Started Phase 1 implementation
