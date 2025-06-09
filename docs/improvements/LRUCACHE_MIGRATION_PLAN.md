# LRUCache Migration Plan

## Overview

This document outlines the plan to migrate from our custom LRUCache implementation to the battle-tested `lru-cache` npm package (v11+).

## Current State

### Custom Implementation
- Location: `/src/utils/LRUCache.js`
- Features:
  - Basic LRU eviction
  - Optional TTL (time-to-live)
  - onEvict callback
  - Simple Map-based implementation

### Current Usage
1. **ProfileInfoCache** (`/src/core/api/ProfileInfoCache.js`)
   - Caches personality profile information from external API
   - Uses TTL for automatic expiration
   - Critical for reducing API calls

2. **WebhookCache** (`/src/utils/webhookCache.js`)
   - Caches Discord webhook instances
   - Prevents excessive webhook creation
   - Critical for Discord rate limit compliance

## Benefits of Migration

### npm `lru-cache` v11+ Features
1. **Async Fetch with Deduplication**
   - Prevents thundering herd problem
   - Multiple requests for same key get single fetch

2. **Size-Based Eviction**
   - Can limit by memory size, not just count
   - Better for caching variable-sized objects

3. **Stale-While-Revalidate**
   - Serve stale content while fetching fresh data
   - Improves perceived performance

4. **Better Performance**
   - Optimized algorithms
   - Lower memory footprint
   - Faster operations

5. **Battle-Tested Edge Cases**
   - Handles race conditions
   - Proper cleanup on errors
   - Well-maintained and documented

## Migration Plan

### Phase 1: Analysis (Pre-Migration)
1. Review all current usages of LRUCache
2. Document specific requirements for each use case
3. Map custom features to lru-cache equivalents

### Phase 2: Implementation
1. Install `lru-cache` package: `npm install lru-cache@^11.0.0`
2. Create adapter layer to maintain current API
3. Update each usage incrementally:
   - ProfileInfoCache first (simpler usage)
   - WebhookCache second (more complex)

### Phase 3: Testing
1. Ensure all existing tests pass
2. Add migration-specific tests
3. Performance benchmarks (before/after)

### Phase 4: Cleanup
1. Remove custom LRUCache implementation
2. Update documentation
3. Remove adapter layer if no longer needed

## Implementation Details

### ProfileInfoCache Migration

Current usage:
```javascript
this.cache = new LRUCache({
  maxSize: 100,
  ttl: cacheTime, // 60 minutes default
  onEvict: (key, value) => {
    logger.debug(`[ProfileInfoCache] Evicting profile for ${key}`);
  }
});
```

Migration to lru-cache:
```javascript
const { LRUCache } = require('lru-cache');

this.cache = new LRUCache({
  max: 100,
  ttl: cacheTime,
  dispose: (key, value) => {
    logger.debug(`[ProfileInfoCache] Evicting profile for ${key}`);
  },
  // New feature: async fetch with deduplication
  fetchMethod: async (key) => {
    return await this.fetcher.fetchProfileInfo(key);
  }
});
```

### WebhookCache Migration

Current usage:
```javascript
this.webhooks = new LRUCache({
  maxSize: 50,
  ttl: 30 * 60 * 1000, // 30 minutes
  onEvict: (key, webhook) => {
    logger.info(`[WebhookCache] Evicting webhook for channel ${key}`);
  }
});
```

Migration to lru-cache:
```javascript
const { LRUCache } = require('lru-cache');

this.webhooks = new LRUCache({
  max: 50,
  ttl: 30 * 60 * 1000,
  dispose: (key, webhook) => {
    logger.info(`[WebhookCache] Evicting webhook for channel ${key}`);
  },
  // New feature: size-based eviction
  sizeCalculation: (webhook) => {
    // Estimate memory usage of webhook object
    return JSON.stringify(webhook).length;
  },
  maxSize: 5 * 1024 * 1024 // 5MB total cache size
});
```

## Breaking Changes

### API Differences
1. `maxSize` → `max` (parameter name change)
2. `onEvict` → `dispose` (callback name change)
3. `set()` returns the cache instance (chainable)
4. `get()` can trigger async fetch if configured

### Behavior Differences
1. More aggressive eviction with size limits
2. Async operations possible (optional)
3. Different internal timing for TTL checks

## Risk Assessment

### Low Risk
- Well-tested npm package
- Backward compatible with adapter
- Can roll back if issues

### Mitigation Strategies
1. Implement behind feature flag initially
2. Monitor cache hit rates before/after
3. Keep custom implementation during transition

## Success Criteria

1. All existing tests pass
2. No increase in API calls
3. Improved memory usage
4. Simplified codebase

## Timeline

- Estimated effort: 2-3 days
- Can be done independently of DDD migration
- Low priority (current implementation works)

## Decision

**Recommendation**: Proceed with migration after Phase 2 of DDD migration is complete. The current implementation is functional and the benefits, while real, are not critical to current operations.

## References

- [lru-cache npm package](https://www.npmjs.com/package/lru-cache)
- [lru-cache v11 migration guide](https://github.com/isaacs/node-lru-cache/blob/main/CHANGELOG.md)