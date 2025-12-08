---
name: tzurot-async-flow
description: BullMQ and async patterns for Tzurot v3 - Job queue architecture, Discord interaction deferral, idempotency, retry strategies, and error handling. Use when working with jobs or async operations.
lastUpdated: '2025-12-08'
---

# Tzurot v3 Async Flow & Job Queue

**Use this skill when:** Creating jobs, processing queue tasks, handling Discord interactions, implementing retry logic, or managing async operations.

## Architecture

```
Discord Interaction
    ↓
bot-client defers reply (3 second window)
    ↓
bot-client HTTP POST → api-gateway
    ↓
api-gateway creates BullMQ job
    ↓
api-gateway waits for completion (10 min timeout)
    ↓
ai-worker picks up job from Redis queue
    ↓
ai-worker processes (AI call, memory retrieval)
    ↓
ai-worker completes job
    ↓
api-gateway returns result
    ↓
bot-client sends webhook reply
```

## BullMQ Fundamentals

### Queue Setup (api-gateway)

```typescript
// services/api-gateway/src/queue.ts
import { Queue, QueueEvents } from 'bullmq';
import { Redis } from 'ioredis';
import { TIMEOUTS, QUEUE_CONFIG } from '@tzurot/common-types';

const connection = new Redis(process.env.REDIS_URL!);

export const aiQueue = new Queue('ai-jobs', {
  connection,
  defaultJobOptions: {
    attempts: 3, // Retry failed jobs
    backoff: {
      type: 'exponential',
      delay: 2000, // Start with 2 second delay
    },
    removeOnComplete: {
      count: QUEUE_CONFIG.COMPLETED_HISTORY_LIMIT, // Keep last 10
      age: 24 * 3600, // or 24 hours
    },
    removeOnFail: {
      count: QUEUE_CONFIG.FAILED_HISTORY_LIMIT, // Keep last 50
      age: 7 * 24 * 3600, // or 7 days
    },
  },
});

export const queueEvents = new QueueEvents('ai-jobs', { connection });
```

### Worker Setup (ai-worker)

```typescript
// services/ai-worker/src/index.ts
import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { TIMEOUTS } from '@tzurot/common-types';
import { processLLMGeneration } from './jobs/LLMGenerationJob.js';

const connection = new Redis(process.env.REDIS_URL!);

const worker = new Worker('ai-jobs', processLLMGeneration, {
  connection,
  concurrency: 5, // Process 5 jobs concurrently
  lockDuration: TIMEOUTS.WORKER_LOCK_DURATION, // 20 minutes
  settings: {
    stalledInterval: 30000, // Check for stalled jobs every 30s
  },
});

worker.on('completed', job => {
  logger.info({ jobId: job.id }, 'Job completed');
});

worker.on('failed', (job, error) => {
  logger.error({ jobId: job?.id, err: error }, 'Job failed');
});
```

## Job Naming Conventions

**Pattern:** `{type}-{identifier}`

```typescript
// ✅ GOOD - Descriptive, unique job IDs
const jobId = `llm-${requestId}`;
const jobId = `audio-${attachmentUrl.split('/').pop()}`;
const jobId = `image-${messageId}`;

// ❌ BAD - Non-unique or unclear
const jobId = `job-${Date.now()}`;
const jobId = `request`;
```

### Job ID Prefixes (in common-types)

```typescript
// packages/common-types/src/constants/queue.ts
export const JOB_PREFIXES = {
  LLM_GENERATION: 'llm-',
  AUDIO_TRANSCRIPTION: 'audio-',
  IMAGE_DESCRIPTION: 'image-',
} as const;

// Usage
import { JOB_PREFIXES } from '@tzurot/common-types';
const jobId = `${JOB_PREFIXES.LLM_GENERATION}${requestId}`;
```

## Discord Interaction Deferral Pattern

**CRITICAL:** Discord requires response within 3 seconds, but AI calls take longer.

### The Mandatory Pattern

```typescript
// bot-client/handlers/interactionCreate.ts
client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  // 1. IMMEDIATELY defer the reply (within 3 seconds)
  await interaction.deferReply({ ephemeral: false });

  try {
    // 2. Make slow HTTP call to api-gateway
    const response = await fetch(`${GATEWAY_URL}/ai/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestData),
    });

    const result = await response.json();

    // 3. Edit the deferred reply with actual response
    await interaction.editReply({
      content: result.content,
    });
  } catch (error) {
    // 4. Edit with error message
    await interaction.editReply({
      content: '❌ Sorry, something went wrong processing your request.',
    });
  }
});
```

### Why This Matters

```
Time: 0s      User sends command
Time: 0.1s    bot-client defers reply ✅
Time: 0.5s    api-gateway creates job
Time: 1s      ai-worker starts processing
Time: 5s      AI API returns response ✅
Time: 5.1s    bot-client edits deferred reply ✅

Without deferral:
Time: 0s      User sends command
Time: 5s      Response ready
Time: 5.1s    Try to reply... ❌ TIMEOUT (3s limit)
```

## Job Processor Pattern

### Job Data Structure

```typescript
// packages/common-types/src/types/queue-types.ts
export interface LLMGenerationJobData {
  requestId: string;
  personalityId: string;
  channelId: string;
  guildId?: string;
  userId: string;
  userMessage: string;
  conversationHistory: ConversationMessage[];
  attachments?: Attachment[];
}
```

### Job Processor Implementation

```typescript
// ai-worker/jobs/LLMGenerationJob.ts
import type { Job } from 'bullmq';
import type { LLMGenerationJobData } from '@tzurot/common-types';

export async function processLLMGeneration(
  job: Job<LLMGenerationJobData>
): Promise<AIGenerationResponse> {
  const { personalityId, userMessage, conversationHistory } = job.data;

  // Update job progress
  await job.updateProgress(10);

  // 1. Load personality config
  const personality = await personalityService.getPersonality(personalityId);
  if (!personality) {
    throw new Error(`Personality not found: ${personalityId}`);
  }

  await job.updateProgress(30);

  // 2. Retrieve relevant memories
  const embedding = await generateEmbedding(userMessage);
  const memories = await memoryService.findSimilar(personalityId, embedding);

  await job.updateProgress(50);

  // 3. Call AI provider
  const response = await aiProvider.generateResponse({
    model: personality.llmConfig.model,
    messages: [...conversationHistory, { role: 'user', content: userMessage }],
    temperature: personality.llmConfig.temperature,
    systemPrompt: personality.systemPrompt,
    memories,
  });

  await job.updateProgress(90);

  // 4. Store new memory
  await memoryService.storeMemory({
    personalityId,
    content: response.content,
    embedding: await generateEmbedding(response.content),
  });

  await job.updateProgress(100);

  return {
    content: response.content,
    model: response.model,
    personalityName: personality.name,
    usage: response.usage,
  };
}
```

## Job Chaining (Preprocessing)

**Pattern:** Preprocessing jobs → Main job

```typescript
// api-gateway/routes/ai.ts
async function handleAIRequest(req: Request, res: Response): Promise<void> {
  const { attachments, ...requestData } = req.body;

  const preprocessingJobs: string[] = [];

  // 1. Create audio transcription job if needed
  if (hasAudioAttachment(attachments)) {
    const audioJob = await aiQueue.add(
      'audio-transcription',
      { attachmentUrl: attachments[0].url },
      { jobId: `audio-${requestId}` }
    );
    preprocessingJobs.push(audioJob.id);
  }

  // 2. Create image description job if needed
  if (hasImageAttachment(attachments)) {
    const imageJob = await aiQueue.add(
      'image-description',
      { attachmentUrl: attachments[0].url },
      { jobId: `image-${requestId}` }
    );
    preprocessingJobs.push(imageJob.id);
  }

  // 3. Create main LLM job that depends on preprocessing
  const llmJob = await aiQueue.add('llm-generation', requestData, {
    jobId: `llm-${requestId}`,
    parent:
      preprocessingJobs.length > 0 ? { id: preprocessingJobs[0], queue: 'ai-jobs' } : undefined,
  });

  // 4. Wait for LLM job completion
  await waitForJobCompletion(llmJob.id);
}
```

## Idempotency

**Problem:** Duplicate requests cause duplicate jobs

### Solution: Deduplication with Redis

```typescript
// api-gateway/utils/deduplication.ts
import { Redis } from 'ioredis';
import { INTERVALS } from '@tzurot/common-types';

class DeduplicationCache {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Check if request was already processed recently
   * Returns true if duplicate, false if first time
   */
  async isDuplicate(requestId: string): Promise<boolean> {
    const key = `dedup:${requestId}`;

    // Try to set key, succeeds only if doesn't exist
    const result = await this.redis.set(
      key,
      '1',
      'EX',
      INTERVALS.REQUEST_DEDUP_WINDOW / 1000, // 5 seconds
      'NX' // Only set if not exists
    );

    return result === null; // null means key already existed
  }
}

// Usage in route
app.post('/ai/generate', async (req, res) => {
  const requestId = generateRequestId(req.body);

  if (await deduplicationCache.isDuplicate(requestId)) {
    logger.warn({ requestId }, 'Duplicate request detected');
    return res.status(429).json({ error: 'Duplicate request' });
  }

  // Process request...
});
```

## Retry Strategy

### Job-Level Retries (BullMQ)

```typescript
// Automatic retries for transient errors
await aiQueue.add('llm-generation', data, {
  attempts: 3, // Retry up to 3 times
  backoff: {
    type: 'exponential',
    delay: 2000, // 2s, 4s, 8s
  },
});
```

### Custom Retry Logic

```typescript
// ai-worker/utils/retry.ts
import { RETRY_CONFIG } from '@tzurot/common-types';

async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    maxAttempts?: number;
    initialDelayMs?: number;
  } = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? RETRY_CONFIG.MAX_ATTEMPTS;
  const initialDelay = options.initialDelayMs ?? RETRY_CONFIG.INITIAL_DELAY_MS;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxAttempts) {
        throw error; // Final attempt failed
      }

      // Check if error is retryable
      if (!isRetryableError(error)) {
        throw error; // Don't retry non-transient errors
      }

      const delay = initialDelay * Math.pow(2, attempt - 1);
      logger.warn({ attempt, maxAttempts, delayMs: delay }, 'Retrying after error');

      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw new Error('Should not reach here');
}

function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  // Network errors
  if (error.message.includes('ECONNREFUSED')) return true;
  if (error.message.includes('ETIMEDOUT')) return true;
  if (error.message.includes('ENOTFOUND')) return true;

  // Rate limits (should retry after delay)
  if (error.message.includes('429')) return true;

  // Server errors (5xx)
  if (error.message.includes('502')) return true;
  if (error.message.includes('503')) return true;
  if (error.message.includes('504')) return true;

  return false;
}
```

## Error Handling

### Job Failure Categories

**1. Retryable Errors** (transient issues)

- Network timeouts
- Rate limits (429)
- Service unavailable (503)

**2. Non-Retryable Errors** (permanent failures)

- Invalid input (400)
- Not found (404)
- Authentication failed (401)

### Error Handling in Job Processor

```typescript
export async function processLLMGeneration(
  job: Job<LLMGenerationJobData>
): Promise<AIGenerationResponse> {
  try {
    // Process job...
    return result;
  } catch (error) {
    logger.error({ jobId: job.id, err: error }, 'Job failed');

    // Classify error
    if (error instanceof ValidationError) {
      // Non-retryable: Bad input data
      throw new Error(`Invalid job data: ${error.message}`);
    }

    if (error instanceof AIProviderError) {
      if (error.statusCode === 429) {
        // Retryable: Rate limit, will retry
        throw error;
      }
      if (error.statusCode >= 500) {
        // Retryable: Server error, will retry
        throw error;
      }
      // Non-retryable: Client error
      throw new Error(`AI provider error: ${error.message}`);
    }

    // Unknown error, don't retry
    throw error;
  }
}
```

## Waiting for Job Completion

### Pattern: Wait with Timeout

```typescript
// api-gateway/routes/ai.ts
import { TIMEOUTS } from '@tzurot/common-types';

async function waitForJobCompletion(
  jobId: string,
  timeoutMs: number = TIMEOUTS.JOB_WAIT
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      queueEvents.off('completed', onCompleted);
      queueEvents.off('failed', onFailed);
      reject(new Error(`Job ${jobId} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const onCompleted = async (args: { jobId: string; returnvalue: any }) => {
      if (args.jobId !== jobId) return;

      clearTimeout(timeout);
      queueEvents.off('completed', onCompleted);
      queueEvents.off('failed', onFailed);
      resolve(args.returnvalue);
    };

    const onFailed = async (args: { jobId: string; failedReason: string }) => {
      if (args.jobId !== jobId) return;

      clearTimeout(timeout);
      queueEvents.off('completed', onCompleted);
      queueEvents.off('failed', onFailed);
      reject(new Error(`Job ${jobId} failed: ${args.failedReason}`));
    };

    queueEvents.on('completed', onCompleted);
    queueEvents.on('failed', onFailed);
  });
}
```

## Concurrency Control

### Worker Concurrency

```typescript
// ai-worker: Process 5 jobs concurrently
const worker = new Worker('ai-jobs', processJob, {
  connection,
  concurrency: 5, // Adjust based on resources
});
```

### Rate Limiting AI API Calls

```typescript
// Use bottleneck for rate limiting
import Bottleneck from 'bottleneck';

const limiter = new Bottleneck({
  maxConcurrent: 5, // Max 5 concurrent API calls
  minTime: 200, // Minimum 200ms between calls
});

async function callAIProvider(request: AIRequest): Promise<AIResponse> {
  return limiter.schedule(() => aiProvider.generate(request));
}
```

## Monitoring Job Queue

### Health Checks

```typescript
// api-gateway/index.ts
app.get('/metrics', async (req, res) => {
  const [waiting, active, completed, failed] = await Promise.all([
    aiQueue.getWaitingCount(),
    aiQueue.getActiveCount(),
    aiQueue.getCompletedCount(),
    aiQueue.getFailedCount(),
  ]);

  res.json({
    queue: {
      waiting,
      active,
      completed,
      failed,
      total: waiting + active,
    },
    timestamp: new Date().toISOString(),
  });
});
```

### Stuck Job Detection

```typescript
// Check for jobs stuck longer than expected
async function detectStuckJobs(): Promise<void> {
  const active = await aiQueue.getActive();
  const now = Date.now();

  for (const job of active) {
    const startedAt = job.processedOn ?? job.timestamp;
    const duration = now - startedAt;

    if (duration > TIMEOUTS.WORKER_LOCK_DURATION) {
      logger.error({ jobId: job.id, durationMs: duration }, 'Stuck job detected');

      // Optional: Force fail the job
      await job.moveToFailed(new Error('Job exceeded lock duration'), true);
    }
  }
}
```

## Timer Patterns (`setTimeout`/`setInterval`)

**⚠️ HORIZONTAL SCALING CONCERN**: `setInterval` creates in-memory state that prevents horizontal scaling. Multiple service instances would each run their own intervals.

### ✅ OK Patterns (use freely)

```typescript
// 1. Request timeouts with AbortController
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 30000);
try {
  const response = await fetch(url, { signal: controller.signal });
} finally {
  clearTimeout(timeout);
}

// 2. One-time delays (retry backoff, startup delays)
await new Promise(resolve => setTimeout(resolve, delayMs));

// 3. Test utilities
await vi.advanceTimersByTimeAsync(1000);
```

### ❌ Scaling Blockers (avoid or migrate)

```typescript
// BAD: Persistent cleanup intervals
this.cleanupInterval = setInterval(() => this.cleanup(), 60000);

// BAD: Reconnection timers without coordination
this.reconnectTimeout = setTimeout(() => this.reconnect(), 5000);
```

### ✅ Alternatives for Cleanup/Scheduled Tasks

**1. BullMQ Repeatable Jobs** (preferred for this codebase):

```typescript
await queue.add(
  'cleanup-cache',
  {},
  {
    repeat: { every: 60000 }, // Every minute
  }
);
```

**2. Redis-based coordination** (for distributed locks)

**3. External scheduler** (Railway cron, etc.)

### Current Known Scaling Blockers

Tracked for future migration:

- `BaseConfigResolver.ts` - cache cleanup interval (used by LlmConfigResolver and PersonaResolver)
- `WebhookManager.ts` - webhook cleanup interval
- `DatabaseNotificationListener.ts` - reconnection timeout

## Testing Async Code

### Mock BullMQ

```typescript
// Test job processor without real queue
describe('processLLMGeneration', () => {
  it('should process job successfully', async () => {
    const mockJob: Job<LLMGenerationJobData> = {
      id: 'test-job',
      data: {
        requestId: 'test-request',
        personalityId: 'test-personality',
        // ... other data
      },
      updateProgress: vi.fn(),
    } as unknown as Job<LLMGenerationJobData>;

    const result = await processLLMGeneration(mockJob);

    expect(result).toHaveProperty('content');
    expect(mockJob.updateProgress).toHaveBeenCalledWith(100);
  });
});
```

## Related Skills

- **tzurot-architecture** - Async workflow design
- **tzurot-constants** - Job names and queue configuration
- **tzurot-observability** - Job logging and correlation IDs
- **tzurot-shared-types** - Job data type definitions
- **tzurot-security** - Signed payloads for job verification

## References

- BullMQ docs: https://docs.bullmq.io/
- Queue constants: `packages/common-types/src/constants/queue.ts`
- Job processors: `services/ai-worker/src/jobs/`
- Discord interaction deferral: https://discord.js.org/#/docs/discord.js/main/class/CommandInteraction?scrollTo=deferReply
