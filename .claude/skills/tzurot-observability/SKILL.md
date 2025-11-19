---
name: tzurot-observability
description: Logging and observability for Tzurot v3 - Structured logging with Pino, correlation IDs, error tracking, privacy considerations, and Railway log analysis. Use when adding logging or debugging production issues.
---

# Tzurot v3 Observability & Logging

**Use this skill when:** Adding logging, debugging production issues, tracking requests across services, or implementing health checks.

## Core Principles

1. **Structured logging** - JSON format for easy parsing
2. **Privacy first** - Never log secrets, tokens, or PII
3. **Correlation IDs** - Track requests across microservices
4. **Log levels** - Appropriate verbosity for each environment
5. **Context-rich** - Include relevant metadata for debugging

## Logging Stack

- **Logger:** Pino (fast, structured JSON logger)
- **Transport:** stdout (Railway captures logs)
- **Format:** JSON lines
- **Levels:** trace, debug, info, warn, error, fatal

## Logger Setup

### Creating Loggers

```typescript
// packages/common-types/src/utils/logger.ts
import pino from 'pino';

export function createLogger(serviceName: string): pino.Logger {
  return pino({
    name: serviceName,
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level: (label) => {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

// Usage in services
import { createLogger } from '@tzurot/common-types';
const logger = createLogger('PersonalityService');
```

### Log Levels

**Use appropriate levels:**

```typescript
// TRACE - Very detailed, disabled in production
logger.trace({ functionArgs }, 'Function called');

// DEBUG - Detailed debugging information
logger.debug({ userId, channelId }, 'Processing message');

// INFO - General information about system operation
logger.info({ personalityId }, 'Loaded personality config');

// WARN - Warning about potential issues
logger.warn({ attempt, maxAttempts }, 'Retrying after failure');

// ERROR - Error that needs attention but service continues
logger.error({ err: error, jobId }, 'Job processing failed');

// FATAL - Service cannot continue, immediate action required
logger.fatal({ err: error }, 'Failed to connect to database');
```

## Structured Logging Patterns

### The Golden Pattern

```typescript
logger.info(
  { contextObject },  // First param: structured data
  'Human readable message'  // Second param: message
);
```

### Good Examples

```typescript
// ✅ GOOD - Context + message
logger.info(
  { personalityId, model: 'claude-sonnet-4.5' },
  'Loaded personality with config'
);

logger.error(
  { err: error, requestId, userId },
  'Failed to process AI request'
);

logger.warn(
  { jobId, attempt: 2, maxAttempts: 3 },
  'Retrying failed job'
);

logger.debug(
  { channelId, messageCount: history.length },
  'Retrieved conversation history'
);
```

### Bad Examples

```typescript
// ❌ BAD - String interpolation loses structure
logger.info(`Loaded personality ${personalityId} with model ${model}`);

// ❌ BAD - No context object
logger.info('Loaded personality');

// ❌ BAD - Logging PII
logger.info({ username, email, ipAddress }, 'User logged in');

// ❌ BAD - Logging secrets
logger.debug({ apiKey, token }, 'Making API call');
```

## Error Logging

### Pino Error Format

```typescript
// ✅ CORRECT - Use 'err' key for errors
logger.error(
  { err: error, context: 'additional data' },
  'Human readable error message'
);

// ❌ WRONG - Don't use 'error' key
logger.error(
  { error: error }, // Wrong!
  'Message'
);
```

**Why `err`?** Pino has special handling for the `err` key:
- Serializes stack traces properly
- Includes error name and message
- Formats consistently across services

### Error Context

```typescript
try {
  await processSomething(id);
} catch (error) {
  // Include context to help debugging
  logger.error(
    {
      err: error,
      id,  // What we were processing
      userId,  // Who triggered it
      attempt,  // Which retry attempt
    },
    'Failed to process item'
  );
  throw error;
}
```

## Correlation IDs

**Problem:** When a user reports "bot didn't reply", how do you find logs across 3 services?

**Solution:** Correlation IDs that flow through entire request chain.

### Implementing Correlation IDs

```typescript
// 1. Generate ID when request enters system (bot-client)
import { randomUUID } from 'crypto';

const requestId = randomUUID();

logger.info({ requestId, messageId }, 'Processing Discord message');

// 2. Include in HTTP request to api-gateway
await fetch(`${GATEWAY_URL}/ai/generate`, {
  headers: {
    'X-Request-ID': requestId,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ requestId, /* ... */ }),
});

// 3. Extract and use in api-gateway
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || randomUUID();
  req.requestId = requestId;  // Attach to request object
  next();
});

app.post('/ai/generate', async (req, res) => {
  logger.info({ requestId: req.requestId }, 'Received AI generation request');
  // ... process
});

// 4. Include in BullMQ job data
await aiQueue.add('llm-generation', {
  requestId: req.requestId,
  // ... other data
});

// 5. Use in ai-worker
export async function processLLMGeneration(job: Job): Promise<Response> {
  const { requestId } = job.data;

  logger.info({ requestId, jobId: job.id }, 'Processing LLM generation');

  // All logs include requestId
  logger.debug({ requestId, personalityId }, 'Loaded personality');
  logger.debug({ requestId, memoryCount: memories.length }, 'Retrieved memories');
  logger.info({ requestId, model }, 'Calling AI provider');

  return response;
}
```

### Searching Logs with Correlation ID

```bash
# Railway CLI: Find all logs for a request
railway logs --service api-gateway | grep "requestId\":\"abc-123"
railway logs --service ai-worker | grep "requestId\":\"abc-123"
railway logs --service bot-client | grep "requestId\":\"abc-123"
```

## Privacy & Security

### NEVER Log These

**Secrets:**
- API keys (DISCORD_TOKEN, OPENROUTER_API_KEY, etc.)
- Database passwords
- Redis passwords
- Webhook tokens
- Any credential or authentication token

**PII (Personally Identifiable Information):**
- Email addresses
- IP addresses
- Real names
- Phone numbers
- Addresses

**Sensitive User Data:**
- Message content (unless debugging specific issue)
- DM conversations
- Personality system prompts (contain character details)

### Safe to Log

**IDs (anonymized):**
```typescript
// ✅ SAFE - IDs don't reveal personal info
logger.info({ userId: 'discord-123456', channelId: 'channel-789' });
```

**Aggregated Data:**
```typescript
// ✅ SAFE - No individual identification
logger.info({ messageCount: 42, avgLength: 156 });
```

**Error Information:**
```typescript
// ✅ SAFE - Error details without sensitive data
logger.error(
  { err: error, statusCode: 429, endpoint: '/ai/generate' },
  'Rate limit exceeded'
);
```

### Redacting Sensitive Data

```typescript
// Utility to redact sensitive fields
function redactSensitive(obj: any): any {
  const redacted = { ...obj };

  const sensitiveKeys = ['apiKey', 'token', 'password', 'secret', 'email'];

  for (const key of sensitiveKeys) {
    if (key in redacted) {
      redacted[key] = '[REDACTED]';
    }
  }

  return redacted;
}

// Usage
logger.debug(
  redactSensitive({ apiKey: 'sk-123', model: 'gpt-4' }),
  'Making API call'
);
// Logs: { apiKey: '[REDACTED]', model: 'gpt-4' }
```

## Health Checks

### Simple Health Endpoint

```typescript
// api-gateway/index.ts
app.get('/health', async (req, res) => {
  try {
    // Check critical dependencies
    const redisHealthy = await checkRedis();
    const dbHealthy = await checkDatabase();
    const queueHealthy = await checkQueue();

    const isHealthy = redisHealthy && dbHealthy && queueHealthy;

    res.status(isHealthy ? 200 : 503).json({
      status: isHealthy ? 'healthy' : 'degraded',
      services: {
        redis: redisHealthy,
        database: dbHealthy,
        queue: queueHealthy,
      },
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  } catch (error) {
    logger.error({ err: error }, 'Health check failed');
    res.status(503).json({ status: 'unhealthy' });
  }
});

async function checkRedis(): Promise<boolean> {
  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

async function checkDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkQueue(): Promise<boolean> {
  try {
    const count = await aiQueue.getWaitingCount();
    return count !== undefined;
  } catch {
    return false;
  }
}
```

## Metrics Endpoint

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
    memory: {
      heapUsed: process.memoryUsage().heapUsed,
      heapTotal: process.memoryUsage().heapTotal,
      rss: process.memoryUsage().rss,
    },
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
  });
});
```

## Railway Log Analysis

### Viewing Logs

```bash
# Recent logs (last 100 lines)
railway logs --service api-gateway

# Follow logs in real-time
railway logs --service ai-worker --tail

# Logs from specific time
railway logs --service bot-client --since 1h

# All services
railway logs
```

### Filtering Logs

```bash
# Find errors
railway logs --service ai-worker | grep '"level":"error"'

# Find specific request
railway logs | grep "requestId\":\"abc-123"

# Find slow operations
railway logs | grep "durationMs" | grep -v "durationMs\":[0-9]\{1,3\},"

# Count errors by type
railway logs --since 24h | grep '"level":"error"' | jq '.msg' | sort | uniq -c
```

### Common Log Queries

```bash
# 1. Find failed jobs
railway logs --service ai-worker | grep "Job failed"

# 2. Find rate limit errors
railway logs | grep "429"

# 3. Find database connection errors
railway logs | grep "database" | grep "error"

# 4. Find slow requests (>5 seconds)
railway logs | grep "durationMs" | awk -F'"durationMs":' '{print $2}' | awk -F',' '{if($1>5000) print}'

# 5. Find memory warnings
railway logs | grep "heapUsed" | grep "GB"
```

## Performance Logging

### Request Duration

```typescript
// Measure operation duration
async function processRequest(data: RequestData): Promise<Response> {
  const startTime = Date.now();
  const requestId = data.requestId;

  try {
    const result = await doWork(data);

    const durationMs = Date.now() - startTime;
    logger.info(
      { requestId, durationMs, status: 'success' },
      'Request completed'
    );

    return result;
  } catch (error) {
    const durationMs = Date.now() - startTime;
    logger.error(
      { requestId, durationMs, err: error, status: 'failed' },
      'Request failed'
    );
    throw error;
  }
}
```

### Slow Operation Detection

```typescript
const SLOW_THRESHOLD = 5000; // 5 seconds

async function queryDatabase(query: string): Promise<any> {
  const startTime = Date.now();

  const result = await prisma.$queryRaw(query);

  const durationMs = Date.now() - startTime;

  if (durationMs > SLOW_THRESHOLD) {
    logger.warn(
      { durationMs, query: query.substring(0, 100) },
      'Slow database query detected'
    );
  }

  return result;
}
```

## Testing with Logs

### Capturing Logs in Tests

```typescript
describe('MyService', () => {
  let mockLogger: pino.Logger;

  beforeEach(() => {
    mockLogger = {
      info: vi.fn(),
      error: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    } as unknown as pino.Logger;
  });

  it('should log errors', async () => {
    const service = new MyService(mockLogger);

    await expect(service.failingOperation()).rejects.toThrow();

    expect(mockLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      expect.stringContaining('Operation failed')
    );
  });
});
```

### Suppress Logs in Tests

```typescript
// vitest.setup.ts
import pino from 'pino';

// Suppress logs in tests
pino.level = 'silent';
```

## Anti-Patterns

### ❌ Don't Use console.log

```typescript
// ❌ BAD - Not structured, no metadata
console.log('Processing message');
console.error('Error:', error);

// ✅ GOOD - Structured, with context
logger.info({ messageId, channelId }, 'Processing message');
logger.error({ err: error, messageId }, 'Failed to process message');
```

### ❌ Don't Log in Loops

```typescript
// ❌ BAD - Spams logs
for (const item of items) {
  logger.info({ item }, 'Processing item'); // 1000+ log lines!
}

// ✅ GOOD - Log once with count
logger.info({ itemCount: items.length }, 'Processing items');
for (const item of items) {
  await process(item);
}
logger.info({ itemCount: items.length }, 'Finished processing items');
```

### ❌ Don't Log Sensitive Data

```typescript
// ❌ BAD - Logs API key
logger.debug({ apiKey: process.env.OPENROUTER_API_KEY }, 'Calling AI');

// ✅ GOOD - No sensitive data
logger.debug({ provider: 'OpenRouter', model }, 'Calling AI');
```

### ❌ Don't Swallow Errors Silently

```typescript
// ❌ BAD - Silent failure
try {
  await doSomething();
} catch (error) {
  // Nothing logged!
}

// ✅ GOOD - Log and optionally rethrow
try {
  await doSomething();
} catch (error) {
  logger.error({ err: error }, 'Operation failed');
  throw error; // Or handle gracefully
}
```

## Log Levels by Environment

```typescript
// Development: debug level (verbose)
LOG_LEVEL=debug pnpm dev

// Production: info level (normal)
LOG_LEVEL=info

// Troubleshooting: trace level (very verbose)
LOG_LEVEL=trace railway logs --service ai-worker
```

## References

- Pino documentation: https://getpino.io/
- Railway logs: https://docs.railway.app/reference/cli-api#logs
- Logger utility: `packages/common-types/src/utils/logger.ts`
- Privacy logging: `CLAUDE.md#logging`
