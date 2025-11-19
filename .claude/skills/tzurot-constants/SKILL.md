---
name: tzurot-constants
description: Constants management for Tzurot v3 - Identifies magic numbers/strings, guides domain-separated organization, and enforces centralization patterns. Use when writing code with hardcoded values or refactoring.
---

# Tzurot v3 Constants Management

**Use this skill when:** Writing new code with timeouts/delays/strings, refactoring to remove magic numbers, or adding new constants to common-types.

## Core Principle

**NO MAGIC NUMBERS OR STRINGS** - Use named constants from `@tzurot/common-types/constants`

Magic values make code hard to maintain, search, and update. Constants provide:
- **Discoverability** - Easy to find all uses of a value
- **Consistency** - Same value used everywhere
- **Documentation** - JSDoc explains WHY the value was chosen
- **Type Safety** - TypeScript ensures correct usage

## Constants Location

All constants live in `packages/common-types/src/constants/` organized by domain:

```
packages/common-types/src/constants/
├── index.ts          # Barrel export
├── ai.ts             # AI provider settings, model defaults
├── timing.ts         # Timeouts, intervals, TTLs, retry config
├── queue.ts          # Queue config, job prefixes, Redis keys
├── discord.ts        # Discord API limits, colors, text limits
├── error.ts          # Error codes, error messages
├── media.ts          # Media limits, content types
├── message.ts        # Message roles, placeholders
└── service.ts        # Service defaults, app settings
```

## When to Create Constants

### ✅ ALWAYS Create Constants For:

**1. Timeouts and Delays**
```typescript
// ❌ BAD - Magic number
await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000));

// ✅ GOOD - Named constant
import { TIMEOUTS } from '@tzurot/common-types';
await new Promise(resolve => setTimeout(resolve, TIMEOUTS.CACHE_TTL));
```

**2. Redis Key Prefixes**
```typescript
// ❌ BAD - Hardcoded string
await redis.set(`webhook:${messageId}`, data);

// ✅ GOOD - Constant prefix
import { REDIS_KEY_PREFIXES } from '@tzurot/common-types';
await redis.set(`${REDIS_KEY_PREFIXES.WEBHOOK_MESSAGE}${messageId}`, data);
```

**3. Retry Counts and Intervals**
```typescript
// ❌ BAD - Magic numbers
const maxRetries = 3;
const retryDelay = 1000;

// ✅ GOOD - Retry configuration
import { RETRY_CONFIG } from '@tzurot/common-types';
const maxRetries = RETRY_CONFIG.MAX_ATTEMPTS;
const retryDelay = RETRY_CONFIG.INITIAL_DELAY_MS;
```

**4. Buffer Sizes and Limits**
```typescript
// ❌ BAD - Magic number
if (message.content.length > 2000) {
  // chunk message
}

// ✅ GOOD - Discord limit constant
import { TEXT_LIMITS } from '@tzurot/common-types';
if (message.content.length > TEXT_LIMITS.MESSAGE_MAX_LENGTH) {
  // chunk message
}
```

**5. Repeated String Literals**
```typescript
// ❌ BAD - Repeated strings
logger.info('[Bot] Starting...');
logger.info('[Bot] Ready!');

// ✅ GOOD - Constant prefix
const LOG_PREFIX = '[Bot]';
logger.info(`${LOG_PREFIX} Starting...`);
logger.info(`${LOG_PREFIX} Ready!`);
```

**6. Event Types and Channel Names**
```typescript
// ❌ BAD - String literals
client.on('messageCreate', handler);
client.on('interactionCreate', handler);

// ✅ GOOD - Constants (if repeated multiple times)
const DISCORD_EVENTS = {
  MESSAGE_CREATE: 'messageCreate',
  INTERACTION_CREATE: 'interactionCreate',
} as const;
client.on(DISCORD_EVENTS.MESSAGE_CREATE, handler);
```

### ❌ DON'T Create Constants For:

**1. One-Off String Literals**
```typescript
// ✅ FINE - Used once, clear in context
logger.info('Personality cache initialized');
```

**2. Simple Struct Length Checks**
```typescript
// ✅ FINE - Structure validation, not a "magic number"
if (Object.keys(event).length === 2) {
  // Valid event structure
}
```

**3. Test-Only Values**
```typescript
// ✅ FINE - Test-specific, not shared
const mockUserId = 'test-user-123';
```

**4. Self-Documenting Values**
```typescript
// ✅ FINE - The value IS the documentation
const defaultTemperature = 0.8; // AI temperature parameter
```

## Domain-Separated Constants

### `ai.ts` - AI Provider Settings
```typescript
export const AI_DEFAULTS = {
  /** Default temperature for AI responses (0.0 = deterministic, 1.0 = creative) */
  TEMPERATURE: 0.8,
  /** Maximum tokens for AI responses */
  MAX_TOKENS: 4096,
  /** Timeout for AI API calls (milliseconds) */
  API_TIMEOUT: 60000,
} as const;

export const MODEL_DEFAULTS = {
  /** Default OpenRouter model for personalities without specific config */
  DEFAULT: 'anthropic/claude-sonnet-4.5',
  /** Fallback model if primary fails */
  FALLBACK: 'anthropic/claude-sonnet-3.5',
} as const;
```

### `timing.ts` - Timeouts, Intervals, TTLs
```typescript
export const TIMEOUTS = {
  /** Cache TTL for personality/user data (5 minutes) */
  CACHE_TTL: 5 * 60 * 1000,
  /** LLM invocation timeout (8 minutes total) */
  LLM_INVOCATION: 480000,
  /** Job wait timeout in gateway (10 minutes) */
  JOB_WAIT: 600000,
} as const;

export const INTERVALS = {
  /** Webhook cache cleanup interval (1 minute) */
  WEBHOOK_CLEANUP: 60000,
  /** Typing indicator refresh interval (8 seconds) */
  TYPING_INDICATOR_REFRESH: 8000,
  /** Webhook message tracking TTL in Redis (7 days in seconds) */
  WEBHOOK_MESSAGE_TTL: 7 * 24 * 60 * 60,
} as const;

export const RETRY_CONFIG = {
  /** Standard retry attempts for ALL components */
  MAX_ATTEMPTS: 3,
  /** Initial delay before first retry (1 second) */
  INITIAL_DELAY_MS: 1000,
  /** Maximum delay between retries (10 seconds) */
  MAX_DELAY_MS: 10000,
} as const;
```

### `queue.ts` - Queue Configuration, Redis Keys
```typescript
export const QUEUE_CONFIG = {
  /** Maximum number of completed jobs to keep */
  COMPLETED_HISTORY_LIMIT: 10,
  /** Maximum number of failed jobs to keep */
  FAILED_HISTORY_LIMIT: 50,
} as const;

export const REDIS_KEY_PREFIXES = {
  /** Prefix for job result storage */
  JOB_RESULT: 'job-result:',
  /** Prefix for webhook message -> personality mapping */
  WEBHOOK_MESSAGE: 'webhook:',
  /** Prefix for voice transcript cache */
  VOICE_TRANSCRIPT: 'transcript:',
} as const;

export const REDIS_CHANNELS = {
  /** Channel for cache invalidation events */
  CACHE_INVALIDATION: 'cache:invalidation',
} as const;
```

### `discord.ts` - Discord API Limits
```typescript
export const TEXT_LIMITS = {
  /** Discord message content limit */
  MESSAGE_MAX_LENGTH: 2000,
  /** Discord embed title limit */
  EMBED_TITLE_MAX_LENGTH: 256,
  /** Discord embed description limit */
  EMBED_DESCRIPTION_MAX_LENGTH: 4096,
} as const;

export const DISCORD_LIMITS = {
  /** Maximum embeds per message */
  MAX_EMBEDS_PER_MESSAGE: 10,
  /** Maximum fields per embed */
  MAX_FIELDS_PER_EMBED: 25,
  /** Rate limit: messages per channel per second */
  MESSAGES_PER_CHANNEL_PER_SECOND: 5,
} as const;
```

### `error.ts` - Error Codes and Messages
```typescript
export enum TransientErrorCode {
  NetworkError = 'NETWORK_ERROR',
  RateLimitError = 'RATE_LIMIT_ERROR',
  TimeoutError = 'TIMEOUT_ERROR',
  ServiceUnavailable = 'SERVICE_UNAVAILABLE',
}

export const ERROR_MESSAGES = {
  [TransientErrorCode.NetworkError]: 'Network connection failed',
  [TransientErrorCode.RateLimitError]: 'Rate limit exceeded',
  [TransientErrorCode.TimeoutError]: 'Operation timed out',
  [TransientErrorCode.ServiceUnavailable]: 'Service temporarily unavailable',
} as const;
```

## Import Pattern

Always import from the barrel export:

```typescript
// ✅ CORRECT - Import from index
import {
  TIMEOUTS,
  INTERVALS,
  REDIS_KEY_PREFIXES,
  REDIS_CHANNELS,
  TEXT_LIMITS,
  RETRY_CONFIG,
} from '@tzurot/common-types';

// ❌ WRONG - Direct file imports
import { TIMEOUTS } from '@tzurot/common-types/constants/timing';
```

## Naming Conventions

### Constant Objects: SCREAMING_SNAKE_CASE
```typescript
export const RETRY_CONFIG = { /* ... */ } as const;
export const REDIS_KEY_PREFIXES = { /* ... */ } as const;
```

### Properties: SCREAMING_SNAKE_CASE
```typescript
export const TIMEOUTS = {
  CACHE_TTL: 5 * 60 * 1000,
  LLM_INVOCATION: 480000,
} as const;
```

### Always Use `as const`
```typescript
// ✅ GOOD - Readonly, TypeScript infers literal types
export const LIMITS = {
  MAX_RETRIES: 3,
} as const;

// ❌ BAD - Mutable, TypeScript infers wide types
export const LIMITS = {
  MAX_RETRIES: 3,
};
```

## Documentation Requirements

**Always add JSDoc comments** explaining:
1. What the constant represents
2. Why the value was chosen
3. Units (seconds, milliseconds, etc.)

```typescript
export const TIMEOUTS = {
  /**
   * Cache TTL for personality/user data (5 minutes)
   *
   * Chosen to balance:
   * - Fresh data for config changes (users notice within 5min)
   * - Reduced database load (most requests hit cache)
   * - Memory usage (TTL prevents indefinite growth)
   */
  CACHE_TTL: 5 * 60 * 1000,

  /**
   * LLM invocation timeout for all retry attempts combined (8 minutes)
   *
   * Calculation:
   * - Per-attempt timeout: 3 minutes (LLM_PER_ATTEMPT)
   * - Max attempts: 3 (RETRY_CONFIG.MAX_ATTEMPTS)
   * - Total: 3 * 3min = 9min (rounded down to 8min for safety buffer)
   */
  LLM_INVOCATION: 480000,
} as const;
```

## Config vs. Constants

**Environment Variables (Config)** - Values that differ per environment:
- API keys (DISCORD_TOKEN, OPENROUTER_API_KEY)
- Database URLs (DATABASE_URL, REDIS_URL)
- Service URLs (GATEWAY_URL, PUBLIC_GATEWAY_URL)

**Application Constants** - Values that are the same across environments:
- Retry limits (RETRY_CONFIG.MAX_ATTEMPTS)
- Timeouts (TIMEOUTS.CACHE_TTL)
- Discord limits (TEXT_LIMITS.MESSAGE_MAX_LENGTH)

```typescript
// ❌ WRONG - Hardcoded API key
const apiKey = 'sk-1234567890';

// ✅ RIGHT - From environment
const apiKey = process.env.OPENROUTER_API_KEY;

// ✅ RIGHT - Application constant
const maxRetries = RETRY_CONFIG.MAX_ATTEMPTS;
```

## Centralization Rule

**If a value is used in more than one file, it moves to `common-types/constants`**

```typescript
// services/bot-client/src/redis.ts
const WEBHOOK_TTL = 7 * 24 * 60 * 60; // Used here

// services/api-gateway/src/webhooks.ts
const WEBHOOK_TTL = 7 * 24 * 60 * 60; // AND here

// ❌ DUPLICATION - Move to common-types!
```

```typescript
// packages/common-types/src/constants/timing.ts
export const INTERVALS = {
  WEBHOOK_MESSAGE_TTL: 7 * 24 * 60 * 60,
} as const;

// ✅ CENTRALIZED - Both services import this
```

## Refactoring to Constants

### Step 1: Identify Magic Values
```bash
# Search for common patterns
grep -r "60000\|5000\|3000" src/
grep -r "redis.set\|redis.get" src/
grep -r "setTimeout\|setInterval" src/
```

### Step 2: Determine Domain
- Timeouts/delays → `timing.ts`
- Redis keys → `queue.ts`
- Discord limits → `discord.ts`
- AI config → `ai.ts`

### Step 3: Add to Appropriate File
```typescript
// packages/common-types/src/constants/timing.ts
export const TIMEOUTS = {
  /** New constant with documentation */
  MY_NEW_TIMEOUT: 60000,
} as const;
```

### Step 4: Export from Index
```typescript
// packages/common-types/src/constants/index.ts
export { TIMEOUTS } from './timing.js';
```

### Step 5: Update Usage
```typescript
// Before
const timeout = 60000;

// After
import { TIMEOUTS } from '@tzurot/common-types';
const timeout = TIMEOUTS.MY_NEW_TIMEOUT;
```

## Anti-Patterns

### ❌ Don't Nest Constants Objects Too Deeply
```typescript
// ❌ BAD - Too nested
export const CONFIG = {
  AI: {
    PROVIDERS: {
      OPENROUTER: {
        TIMEOUTS: {
          DEFAULT: 60000,
        },
      },
    },
  },
};

// ✅ GOOD - Flat structure
export const AI_TIMEOUTS = {
  OPENROUTER_DEFAULT: 60000,
} as const;
```

### ❌ Don't Mix Constants and Functions
```typescript
// ❌ BAD - Functions don't belong in constants files
export const HELPERS = {
  MAX_RETRIES: 3,
  calculateDelay: (attempt: number) => attempt * 1000,
};

// ✅ GOOD - Constants only, put functions in utils/
export const RETRY_CONFIG = {
  MAX_RETRIES: 3,
  INITIAL_DELAY_MS: 1000,
} as const;

// utils/retry.ts
export function calculateDelay(attempt: number): number {
  return attempt * RETRY_CONFIG.INITIAL_DELAY_MS;
}
```

### ❌ Don't Use String Enums for Constants
```typescript
// ❌ BAD - String enum is overkill
enum RedisKeys {
  Webhook = 'webhook:',
  Transcript = 'transcript:',
}

// ✅ GOOD - Simple const object
export const REDIS_KEY_PREFIXES = {
  WEBHOOK_MESSAGE: 'webhook:',
  VOICE_TRANSCRIPT: 'transcript:',
} as const;
```

## References

- Constants documentation: `CLAUDE.md#constants-and-magic-numbers`
- Existing constants: `packages/common-types/src/constants/`
