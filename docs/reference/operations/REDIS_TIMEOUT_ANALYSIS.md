# Redis Timeout Analysis

**Date**: 2025-10-30
**Issue**: Redis timeouts causing bot failures after Railway downtime incident
**Affected**: Both development and production environments

## Summary

Redis timeouts are occurring across all services (api-gateway, ai-worker, bot-client) after a Railway infrastructure incident. While the infrastructure provider claims the issue is resolved, our services continue experiencing timeouts. This analysis identifies several configuration gaps that make our services vulnerable to transient network issues and Redis connection problems.

## Key Findings

### 1. Missing Redis Timeout Configurations

**Current State**: All Redis connections (both direct redis clients and BullMQ) use default timeout settings.

**Problem**: Without explicit timeouts, connections can hang indefinitely waiting for Redis responses.

**Affected Files**:

- `services/api-gateway/src/queue.ts` (BullMQ Queue + QueueEvents)
- `services/ai-worker/src/index.ts` (BullMQ Worker)
- `services/ai-worker/src/redis.ts` (redis client)
- `services/bot-client/src/redis.ts` (redis client)

**Missing Configurations**:

```typescript
{
  socket: {
    connectTimeout: 10000,      // Connection establishment timeout (not set)
    commandTimeout: 5000,        // Individual command timeout (not set)
    keepAlive: 30000,           // TCP keepalive interval (not set)
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000)  // Not set
  },
  maxRetriesPerRequest: 3,      // Retry limit for commands (not set)
}
```

### 2. No Connection Pool Limits

**Current State**: Redis clients don't specify connection pool settings.

**Problem**: Unlimited connections can exhaust Railway's Redis connection limits or create resource leaks.

**Recommendation**: Set reasonable connection pool limits:

```typescript
{
  socket: {
    // ... existing socket config
  },
  // For IORedis (BullMQ's underlying client)
  lazyConnect: false,           // Connect immediately to fail fast
  enableReadyCheck: true,       // Verify Redis is ready
}
```

### 3. BullMQ Job Waiting Strategy

**Current State**: `job.waitUntilFinished(queueEvents, timeoutMs)` uses Redis pub/sub.

**Location**: `services/api-gateway/src/routes/ai.ts:152`

**Problem**: If Redis pub/sub is unreliable due to timeouts, this can cause:

- API requests hanging until timeout
- Memory leaks from waiting promises
- Cascading failures in bot-client

**Current Timeout**: 270 seconds (4.5 minutes) - close to Railway's 5-minute limit

### 4. IPv6 Dependency

**Current State**: All services use `family: 6` for Railway's private network.

**Location**: All Redis configs specify `family: 6`

**Problem**: If Railway's IPv6 network has issues (as might have occurred during downtime), all Redis connections fail.

**Recommendation**: Add fallback to IPv4 or make it configurable:

```typescript
{
  socket: {
    family: envConfig.REDIS_FAMILY || 6, // Allow fallback to 4
    // ...
  }
}
```

### 5. No Connection Health Monitoring

**Current State**: Health checks exist but don't monitor connection state continuously.

**Problem**: Services don't proactively detect degraded Redis connections until a command fails.

**Recommendation**: Add connection event handlers:

```typescript
redis.on('reconnecting', () => {
  logger.warn('[Redis] Attempting to reconnect...');
});

redis.on('end', () => {
  logger.error('[Redis] Connection closed');
});
```

Note: bot-client has some of these handlers (`services/bot-client/src/redis.ts:48-54`), but api-gateway and ai-worker don't.

## Connection Lifecycle Analysis

### Startup

✅ **Good**: All services connect to Redis on startup and log connection status.

### Runtime

⚠️ **Issue**: No automatic reconnection configuration or circuit breaker pattern.

### Shutdown

✅ **Good**: All services properly close Redis connections in graceful shutdown handlers:

- `api-gateway/src/queue.ts:86-91` - Closes QueueEvents and Queue
- `ai-worker/src/redis.ts:73-77` - Closes Redis client
- `bot-client/src/redis.ts:151-155` - Closes Redis client
- `bot-client/src/index.ts:88` - Calls closeRedis() on SIGINT

## Recommended Fixes

### Priority 1: Add Explicit Timeouts (Critical)

**File**: `packages/common-types/src/redis-utils.ts`

Add a new function to create standardized Redis connection options:

```typescript
export interface RedisConnectionOptions {
  host: string;
  port: number;
  password?: string;
  username?: string;
  family?: 4 | 6;
  connectTimeout?: number;
  commandTimeout?: number;
  keepAlive?: number;
  maxRetriesPerRequest?: number;
}

export function createRedisSocketConfig(config: RedisConnectionConfig): RedisConnectionOptions {
  return {
    socket: {
      host: config.host,
      port: config.port,
      family: config.family || 6,
      connectTimeout: 10000, // 10s to establish connection
      commandTimeout: 5000, // 5s per command
      keepAlive: 30000, // 30s TCP keepalive
      reconnectStrategy: (retries: number) => {
        if (retries > 10) {
          // After 10 retries (30+ seconds), give up
          return new Error('Max reconnection attempts reached');
        }
        // Exponential backoff: 100ms, 200ms, 400ms, ..., max 3s
        return Math.min(retries * 100, 3000);
      },
    },
    password: config.password,
    username: config.username,
    maxRetriesPerRequest: 3,
    lazyConnect: false, // Fail fast on startup
    enableReadyCheck: true, // Verify Redis is ready
  };
}
```

### Priority 2: Update All Services to Use New Config (Critical)

**Files to Update**:

1. `services/api-gateway/src/queue.ts`
2. `services/ai-worker/src/index.ts`
3. `services/ai-worker/src/redis.ts`
4. `services/bot-client/src/redis.ts`

**Example Change** (`services/api-gateway/src/queue.ts`):

```typescript
// BEFORE
const redisConfig = {
  host: config.REDIS_HOST,
  port: config.REDIS_PORT,
  password: config.REDIS_PASSWORD,
  family: 6,
  ...(config.REDIS_URL && config.REDIS_URL.length > 0 ? parseRedisUrl(config.REDIS_URL) : {}),
};

// AFTER
import { parseRedisUrl, createRedisSocketConfig } from '@tzurot/common-types';

const parsedUrl =
  config.REDIS_URL && config.REDIS_URL.length > 0 ? parseRedisUrl(config.REDIS_URL) : null;

const redisConfig = createRedisSocketConfig({
  host: parsedUrl?.host || config.REDIS_HOST,
  port: parsedUrl?.port || config.REDIS_PORT,
  password: parsedUrl?.password || config.REDIS_PASSWORD,
  username: parsedUrl?.username,
  family: 6, // Railway private network
});
```

### Priority 3: Add Connection Event Handlers (Important)

**Files to Update**:

1. `services/api-gateway/src/queue.ts` (add to queueEvents)
2. `services/ai-worker/src/index.ts` (add to worker)

**Example** (`services/ai-worker/src/index.ts`):

```typescript
// After creating worker (line 87)
worker.on('error', (error: Error) => {
  logger.error({ err: error }, '[AIWorker] Worker error');
});

// Add these new handlers
worker.on('ioredis:close', () => {
  logger.warn('[AIWorker] Redis connection closed');
});

worker.on('ioredis:reconnecting', (delay: number) => {
  logger.warn({ delay }, '[AIWorker] Redis reconnecting');
});
```

### Priority 4: Add Circuit Breaker for Redis Operations (Optional)

Consider implementing a circuit breaker pattern to prevent cascading failures when Redis is degraded:

```typescript
// packages/common-types/src/circuit-breaker.ts
export class RedisCircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  // If 5 failures in 30 seconds, open circuit for 60 seconds
  constructor(
    private threshold = 5,
    private window = 30000,
    private timeout = 60000
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailure > this.timeout) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker is open');
      }
    }

    try {
      const result = await fn();
      if (this.state === 'half-open') {
        this.reset();
      }
      return result;
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  private recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();

    if (this.failures >= this.threshold) {
      this.state = 'open';
    }
  }

  private reset(): void {
    this.failures = 0;
    this.state = 'closed';
  }
}
```

## Testing Recommendations

After applying fixes:

1. **Local Testing**: Test with intentionally degraded Redis (add latency/packet loss)
2. **Load Testing**: Verify behavior under high concurrent load
3. **Failure Testing**: Test with Redis completely unavailable
4. **Recovery Testing**: Verify graceful recovery when Redis comes back online

## Monitoring Recommendations

Add metrics for:

- Redis connection failures
- Command timeout rate
- Reconnection attempts
- Job wait timeout rate
- Circuit breaker state changes

## Related Issues

- Railway downtime incident (date unknown) - allegedly resolved
- Both dev and production environments affected
- Symptoms: Repeated Redis timeouts preventing bot operation
- User submitted Railway support ticket

## Next Steps

1. ✅ **Complete**: Document findings
2. **Implement Priority 1 fixes**: Add timeout configurations
3. **Implement Priority 2 fixes**: Update all services
4. **Deploy to development**: Test fixes
5. **Monitor for 24 hours**: Verify stability
6. **Deploy to production**: Roll out fixes
7. **Post-mortem**: Review with Railway support ticket response

## Temporary Workaround

If Railway's Redis continues having issues, consider:

1. **Restart all services**: Clear stale connections
2. **Scale down concurrency**: Reduce `WORKER_CONCURRENCY` to minimize connections
3. **Increase timeouts**: Temporary band-aid (not recommended long-term)
4. **Switch to external Redis**: Upstash, Redis Cloud, etc. (requires config changes)

## Notes

- The security issue (leaked database password in CURRENT_WORK.md) has been fixed ✅
- Railway CLI couldn't be installed in sandbox due to network restrictions
- User should rotate dev database password after this session
