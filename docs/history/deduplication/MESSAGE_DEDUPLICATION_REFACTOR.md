# Message Deduplication Refactor

## Problem Statement

The codebase previously contained multiple overlapping mechanisms for message deduplication:

1. A global `processedBotMessages` Set (initialized at bot startup)
2. A global `seenBotMessages` Set (initialized on first use)
3. A `recentReplies` Map used in the prototype patches
4. Patched Discord.js `Message.prototype.reply` method
5. Patched Discord.js `TextChannel.prototype.send` method
6. Multiple setInterval cleaners running on different schedules
7. Multiple timeout-based entry removers

These mechanisms were added incrementally to solve specific deduplication issues, but resulted in:

- Code duplication 
- Potential memory leaks from multiple tracking structures
- Overlapping responsibilities
- Hard-to-trace control flow
- Multiple periodic cleaners

## Solution

We've implemented a unified `MessageTracker` class that:

1. Consolidates all deduplication into a single system
2. Uses a single Map to store all tracked message IDs and operations
3. Provides a clean, reusable API for deduplication checks
4. Has a single, periodic cleanup mechanism
5. Uses more specific, granular tracking identifiers

### Key Changes

1. **Unified Data Structure**: 
   - Replaced multiple tracking sets and maps with a single `processedMessages` Map
   - Map allows us to store both the message ID and a timestamp for timing-based checks

2. **Two Primary Methods**:
   - `track(messageId, type)`: For tracking message IDs with a type prefix
   - `trackOperation(channelId, operationType, options)`: For tracking operations like reply/send

3. **Single Cleanup Mechanism**:
   - One interval that cleans up old entries
   - Timeout-based cleanup for short-lived operation tracking

4. **Error Filtering**:
   - Moved error patterns to constants.js
   - Used the exported ERROR_MESSAGES array for both client emit patching and webhook message filtering
   - Simplified error detection by using `Array.some()` instead of multiple conditions

5. **Discord.js Patching**:
   - Simplified prototype patching for Message.reply and TextChannel.send
   - Both patched methods now use the same MessageTracker mechanism

## Code Structure

```javascript
// Centralized message tracking system for deduplication
class MessageTracker {
  constructor() {
    this.processedMessages = new Map(); // Using Map to store message IDs with timestamps
    this.setupPeriodicCleanup();
  }

  setupPeriodicCleanup() {
    // Clean up the tracker periodically
  }

  // Track a message to prevent duplicate processing
  track(messageId, type = 'message') {
    const trackingId = `${type}-${messageId}`;
    
    // If already processed, return false to indicate duplicate
    if (this.processedMessages.has(trackingId)) {
      // Log warning and return false
      return false;
    }
    
    // Mark as processed with current timestamp
    this.processedMessages.set(trackingId, Date.now());
    return true;
  }

  // Track a specific operation signature (for reply/send operations)
  trackOperation(channelId, operationType, optionsSignature) {
    const operationId = `${operationType}-${channelId}-${optionsSignature}`;
    
    // Check for recent identical operations
    if (this.processedMessages.has(operationId)) {
      const timeAgo = Date.now() - this.processedMessages.get(operationId);
      if (timeAgo < 5000) {
        // Log warning and return false if less than 5 seconds
        return false;
      }
    }
    
    // Record this operation
    this.processedMessages.set(operationId, Date.now());
    
    // Set a timeout to clean up this entry after 10 seconds
    setTimeout(() => {
      this.processedMessages.delete(operationId);
    }, 10000);
    
    return true;
  }
}
```

## Benefits

1. **Reduced Code Size**: The refactored deduplication code is approximately 50% smaller than the original.

2. **Better Memory Management**: A single data structure with a unified cleanup approach means more predictable memory usage.

3. **Improved Readability**: Clear method names and single responsibility make the code easier to understand.

4. **Easier Maintenance**: Future deduplication improvements can be made in one place rather than throughout the codebase.

5. **Less Object Creation**: Fewer temporary objects are created for tracking, reducing garbage collection pressure.

## Testing

The new MessageTracker implementation is verified with unit tests that confirm:

1. Basic message tracking works
2. Duplicate messages are correctly identified
3. Time-based operation tracking works as expected
4. Cleanup mechanisms function properly

## Future Improvements

1. **Event-Based Cleanup**: Consider using an event-based system rather than timeouts for cleanup.
2. **Configurable Thresholds**: Make the deduplication time windows configurable.
3. **Redis Integration**: For multi-instance deployments, consider moving message tracking to Redis.
4. **Metrics Collection**: Add metrics to track deduplication effectiveness.

## Conclusion

This refactoring significantly simplifies the code while maintaining or improving the core deduplication functionality. It's now easier to understand, maintain, and extend in the future.