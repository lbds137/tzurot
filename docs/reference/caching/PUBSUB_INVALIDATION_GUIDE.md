# Creating a New Cache with Pub/Sub Invalidation

Follow this pattern when you need cross-instance cache invalidation.

## When to Use This Pattern

Use Redis pub/sub invalidation when **staleness causes correctness issues** (wrong behavior, not just stale UX). For example:

- Channel activation cache - stale = missed messages
- Personality cache - stale = using deleted/modified personality

## Step 1: Add Redis Channel

```typescript
// packages/common-types/src/constants/queue.ts
export const REDIS_CHANNELS = {
  // ... existing
  YOUR_NEW_CACHE_INVALIDATION: 'cache:your-cache-invalidation',
} as const;
```

## Step 2: Create Invalidation Service

```typescript
// packages/common-types/src/services/YourCacheInvalidationService.ts
import {
  BaseCacheInvalidationService,
  type EventValidator,
} from './base/BaseCacheInvalidationService.js';
import { REDIS_CHANNELS } from '../constants/queue.js';
import type { Redis } from 'ioredis';

export type YourInvalidationEvent = { type: 'item'; itemId: string } | { type: 'all' };

export function isValidYourInvalidationEvent(obj: unknown): obj is YourInvalidationEvent {
  if (typeof obj !== 'object' || obj === null) return false;
  const event = obj as Record<string, unknown>;

  if (event.type === 'all') {
    return Object.keys(event).length === 1;
  }
  if (event.type === 'item') {
    return typeof event.itemId === 'string' && Object.keys(event).length === 2;
  }
  return false;
}

export class YourCacheInvalidationService extends BaseCacheInvalidationService<YourInvalidationEvent> {
  constructor(redis: Redis) {
    super(
      redis,
      REDIS_CHANNELS.YOUR_NEW_CACHE_INVALIDATION,
      'YourCacheInvalidation',
      isValidYourInvalidationEvent as EventValidator<YourInvalidationEvent>,
      { logSubscription: true, logEvents: true, logPublish: true }
    );
  }

  async invalidateItem(itemId: string): Promise<void> {
    await this.publish({ type: 'item', itemId });
  }

  async invalidateAll(): Promise<void> {
    await this.publish({ type: 'all' });
  }
}
```

## Step 3: Export from common-types

```typescript
// packages/common-types/src/index.ts
export {
  YourCacheInvalidationService,
  isValidYourInvalidationEvent,
  type YourInvalidationEvent,
} from './services/YourCacheInvalidationService.js';
```

## Step 4: Register in Service Registry (bot-client)

```typescript
// services/bot-client/src/services/serviceRegistry.ts
import type { YourCacheInvalidationService } from '@tzurot/common-types';

let yourCacheInvalidationService: YourCacheInvalidationService | undefined;

export interface RegisteredServices {
  // ... existing
  yourCacheInvalidationService: YourCacheInvalidationService;
}

export function getYourCacheInvalidationService(): YourCacheInvalidationService {
  if (yourCacheInvalidationService === undefined) {
    throw new Error('YourCacheInvalidationService not registered.');
  }
  return yourCacheInvalidationService;
}
```

## Step 5: Subscribe on Startup

```typescript
// services/bot-client/src/index.ts
await services.yourCacheInvalidationService.subscribe(event => {
  if (event.type === 'item') {
    invalidateYourCacheItem(event.itemId);
  } else if (event.type === 'all') {
    clearAllYourCache();
  }
});
```

## Step 6: Publish on Changes

```typescript
// In the command/handler that modifies the cached data
const invalidationService = getYourCacheInvalidationService();
await invalidationService.invalidateItem(itemId);
```

## Existing Implementations

Reference these for working examples:

- `CacheInvalidationService` - Personality cache
- `ChannelActivationCacheInvalidationService` - Channel activation cache
