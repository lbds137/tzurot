# Memory Management Implementation Plan

**Created**: December 2024  
**Status**: In Progress  
**Priority**: HIGH

## 🚨 IMPORTANT: Migration to npm lru-cache Required

**Before implementing any additional caching improvements**, we need to migrate from our custom LRUCache implementation to the battle-tested npm `lru-cache` package (v11+).

### Why This Is Critical

1. **Avoid spreading technical debt** - Don't implement custom cache in more places
2. **Better features** - npm lru-cache offers async fetching, size-based eviction, stale-while-revalidate
3. **Performance** - Years of optimization we can't match
4. **Reliability** - 65M+ weekly downloads, extensively tested

### Migration Steps

1. Install `lru-cache` package: `npm install lru-cache`
2. Update `ProfileInfoCache` to use npm lru-cache
3. Update `webhookCache` to use npm lru-cache
4. Remove custom `src/utils/LRUCache.js`
5. Update all tests

## Current Status

### ✅ Completed (December 2024)

1. **Created custom LRUCache implementation**
   - Basic LRU eviction
   - TTL support
   - Comprehensive tests

2. **Implemented LRU in ProfileInfoCache**
   - Limited to 1000 profiles
   - 24-hour TTL
   - Hourly cleanup interval

3. **Implemented LRU in webhookCache**
   - Limited to 100 webhooks
   - 24-hour TTL
   - Proper cleanup with webhook.destroy()

### ❌ Remaining Tasks (DO NOT START UNTIL MIGRATION)

1. **Replace avatarWarmupCache with LRU implementation**
   - Currently in `avatarManager.js`
   - No size limits currently
   - Should limit to reasonable number (e.g., 500 avatars)

2. **Add cleanup to errorTracker**
   - Currently in `utils/errorTracker.js`
   - Tracks error history indefinitely
   - Should implement sliding window (e.g., last 24 hours)

3. **Review pendingRequests in aiRequestManager**
   - Currently uses Map without cleanup
   - Should add timeout cleanup for stale requests
   - Consider using lru-cache's built-in deduplication

4. **Check messageTracker for memory issues**
   - Verify it has proper cleanup
   - Add size limits if needed

## Implementation Priority

1. **FIRST**: Migrate to npm lru-cache
2. **THEN**: Continue with remaining caches in this order:
   - avatarWarmupCache (HIGH RISK - unbounded)
   - errorTracker (MEDIUM RISK - grows over time)
   - pendingRequests cleanup (LOW RISK - but should be fixed)
   - messageTracker review (LOW RISK - verify only)

## Code Locations

- `src/utils/LRUCache.js` - Custom implementation to be replaced
- `src/core/api/ProfileInfoCache.js` - Uses custom LRU ✅
- `src/utils/webhookCache.js` - Uses custom LRU ✅
- `src/utils/avatarManager.js` - Needs LRU ❌
- `src/utils/errorTracker.js` - Needs cleanup ❌
- `src/utils/aiRequestManager.js` - Needs timeout cleanup ❌
- `src/messageTracker.js` - Needs review ❌

## Example Migration Code

```javascript
// Example: How ProfileInfoCache should look after migration
const { LRUCache } = require('lru-cache');

class ProfileInfoCache {
  constructor(options = {}) {
    this.cache = new LRUCache({
      max: options.maxSize || 1000,
      ttl: options.cacheDuration || 24 * 60 * 60 * 1000,
      
      // Automatic async fetching with deduplication!
      fetchMethod: async (profileName) => {
        return await this.fetchProfile(profileName);
      },
      
      // Better disposal handling
      dispose: (value, key, reason) => {
        logger.debug(`Profile ${key} evicted: ${reason}`);
      }
    });
  }
  
  // So much simpler!
  async get(profileName) {
    return await this.cache.fetch(profileName);
  }
}
```

## Notes

- All memory issues identified in CODE_IMPROVEMENT_OPPORTUNITIES.md
- Security vulnerabilities have been fixed (undici override)
- Test coverage exists for current implementations
- Migration should maintain same API surface where possible