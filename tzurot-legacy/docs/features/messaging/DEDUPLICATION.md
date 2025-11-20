# Message Deduplication System

This document explains Tzurot's sophisticated multi-layer deduplication system that prevents duplicate responses and message processing loops.

## Table of Contents

- [Overview](#overview)
- [Why Deduplication is Necessary](#why-deduplication-is-necessary)
- [Deduplication Layers](#deduplication-layers)
- [Implementation Details](#implementation-details)
- [Configuration](#configuration)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## Overview

The deduplication system prevents the bot from:
- Responding multiple times to the same message
- Creating infinite loops with webhooks
- Processing Discord's message update events as new messages
- Responding to its own messages
- Handling race conditions in concurrent message processing

## Why Deduplication is Necessary

### Discord Webhook Challenges

1. **Webhook Echo**: When the bot sends a message via webhook, Discord fires a `messageCreate` event
2. **Message Updates**: Edited messages can trigger multiple events
3. **Thread Messages**: Messages in threads can trigger duplicate events
4. **Reply Chains**: Complex reply chains can cause multiple processing attempts

### Technical Challenges

1. **Race Conditions**: Multiple events for the same message arriving simultaneously
2. **Distributed Events**: Discord can send the same event multiple times
3. **Webhook Detection**: Identifying which webhooks belong to the bot
4. **Performance**: Deduplication must be fast to not impact response time

## Deduplication Layers

The system implements multiple layers of protection:

### Layer 1: Message ID Tracking

The first and fastest check - tracking processed message IDs:

```javascript
// In messageTracker.js
const processedMessages = new Set();
const MESSAGE_CACHE_SIZE = 1000;

function hasProcessedMessage(messageId) {
  return processedMessages.has(messageId);
}

function markMessageAsProcessed(messageId) {
  processedMessages.add(messageId);
  
  // Prevent memory leak by limiting set size
  if (processedMessages.size > MESSAGE_CACHE_SIZE) {
    const firstId = processedMessages.values().next().value;
    processedMessages.delete(firstId);
  }
}
```

### Layer 2: Webhook User Tracking

Identifies messages from the bot's own webhooks:

```javascript
// In webhookUserTracker.js
const ourWebhooks = new Map(); // channelId -> Set<webhookId>

function isOurWebhook(message) {
  // Check if message is from a webhook
  if (!message.webhookId) return false;
  
  // Check if we've cached this webhook
  const channelWebhooks = ourWebhooks.get(message.channel.id);
  if (channelWebhooks?.has(message.webhookId)) {
    return true;
  }
  
  // Check webhook naming pattern
  if (message.author.bot && message.author.username.includes(' | ')) {
    return true;
  }
  
  return false;
}
```

### Layer 3: Content Similarity Detection

Prevents responding to near-duplicate messages:

```javascript
// In contentSimilarity.js
function checkSimilarity(content1, content2, threshold = 0.9) {
  // Remove whitespace and normalize
  const normalized1 = content1.toLowerCase().replace(/\s+/g, ' ').trim();
  const normalized2 = content2.toLowerCase().replace(/\s+/g, ' ').trim();
  
  // Check exact match first
  if (normalized1 === normalized2) return true;
  
  // Calculate similarity score
  const similarity = calculateSimilarity(normalized1, normalized2);
  return similarity >= threshold;
}
```

### Layer 4: Nonce Tracking

Discord's nonce field helps identify message uniqueness:

```javascript
// Track nonces to detect duplicate events
const recentNonces = new Map(); // nonce -> timestamp

function isDuplicateNonce(nonce) {
  if (!nonce) return false;
  
  const existing = recentNonces.get(nonce);
  if (existing) {
    return true;
  }
  
  recentNonces.set(nonce, Date.now());
  cleanOldNonces(); // Clean entries older than 5 minutes
  return false;
}
```

### Layer 5: Command Deduplication Middleware

Special handling for command messages:

```javascript
// In commands/middleware/deduplication.js
const executingCommands = new Set();

async function deduplicationMiddleware(message, args, next) {
  const key = `${message.id}-${message.author.id}`;
  
  if (executingCommands.has(key)) {
    throw new Error('Command already being processed');
  }
  
  executingCommands.add(key);
  try {
    return await next();
  } finally {
    executingCommands.delete(key);
  }
}
```

## Implementation Details

### Message Processing Flow

```
New Message Event
       │
       ▼
┌─────────────────┐
│ Check Message ID │ ──Yes──→ Ignore
└────────┬────────┘
         │ No
         ▼
┌─────────────────┐
│ Check if Our    │ ──Yes──→ Ignore
│ Webhook         │
└────────┬────────┘
         │ No
         ▼
┌─────────────────┐
│ Check Nonce     │ ──Yes──→ Ignore
└────────┬────────┘
         │ No
         ▼
┌─────────────────┐
│ Check Content   │ ──Yes──→ Ignore
│ Similarity      │
└────────┬────────┘
         │ No
         ▼
   Process Message
```

### Thread-Safe Implementation

The deduplication system uses JavaScript's single-threaded nature but still handles async race conditions:

```javascript
class MessageDeduplicator {
  constructor() {
    this.processing = new Map(); // messageId -> Promise
  }
  
  async processMessage(message, handler) {
    // Check if already processing
    const existing = this.processing.get(message.id);
    if (existing) {
      return existing; // Return existing promise
    }
    
    // Create new processing promise
    const promise = this.deduplicateAndProcess(message, handler);
    this.processing.set(message.id, promise);
    
    try {
      return await promise;
    } finally {
      // Clean up after processing
      this.processing.delete(message.id);
    }
  }
}
```

### Memory Management

To prevent memory leaks, all deduplication stores implement size limits:

```javascript
class BoundedCache {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
  }
  
  set(key, value) {
    // Delete oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, value);
  }
}
```

## Configuration

### Tuning Parameters

```javascript
// In constants.js or config
const DEDUP_CONFIG = {
  MESSAGE_CACHE_SIZE: 1000,        // Number of message IDs to track
  NONCE_TIMEOUT: 5 * 60 * 1000,    // 5 minutes
  SIMILARITY_THRESHOLD: 0.9,        // 90% similarity
  WEBHOOK_CACHE_TIME: 3600000,      // 1 hour
  COMMAND_TIMEOUT: 30000            // 30 seconds
};
```

### Performance Considerations

1. **Cache Sizes**: Larger caches use more memory but prevent more duplicates
2. **Timeouts**: Shorter timeouts free memory faster but might miss slow duplicates
3. **Similarity Threshold**: Lower values catch more duplicates but risk false positives

## Monitoring

### Deduplication Metrics

The system tracks:
- Total messages processed
- Messages deduplicated by each layer
- Cache hit rates
- Memory usage

```javascript
// In monitoring/deduplicationMonitor.js
class DeduplicationMonitor {
  constructor() {
    this.stats = {
      processed: 0,
      duplicateById: 0,
      duplicateByWebhook: 0,
      duplicateByNonce: 0,
      duplicateBySimilarity: 0
    };
  }
  
  getStats() {
    return {
      ...this.stats,
      deduplicationRate: this.calculateRate(),
      cacheEfficiency: this.calculateEfficiency()
    };
  }
}
```

### Debug Logging

Enable detailed deduplication logging:

```javascript
// Set LOG_LEVEL=debug
logger.debug('[Dedup] Message rejected', {
  messageId: message.id,
  reason: 'duplicate_id',
  layer: 'message_tracker'
});
```

## Troubleshooting

### Common Issues

1. **Bot Not Responding**
   - Check if deduplication is too aggressive
   - Verify similarity threshold isn't too low
   - Ensure message IDs are being cleared properly

2. **Duplicate Responses**
   - Check all deduplication layers are active
   - Verify webhook detection is working
   - Look for race conditions in async handlers

3. **Memory Usage Growing**
   - Check cache size limits
   - Verify cleanup functions are running
   - Monitor for memory leaks in dedup stores

### Testing Deduplication

```javascript
// Test script to verify deduplication
async function testDeduplication() {
  // Test 1: Same message ID
  const msg1 = { id: '123', content: 'test' };
  await processMessage(msg1); // Should process
  await processMessage(msg1); // Should be deduped
  
  // Test 2: Similar content
  const msg2 = { id: '124', content: 'Hello world!' };
  const msg3 = { id: '125', content: 'Hello  world!' };
  await processMessage(msg2); // Should process
  await processMessage(msg3); // Should be deduped
  
  // Test 3: Webhook detection
  const webhookMsg = { 
    id: '126', 
    webhookId: 'xyz',
    author: { bot: true, username: 'Personality | Tzurot' }
  };
  await processMessage(webhookMsg); // Should be deduped
}
```

### Manual Cache Management

If needed, caches can be manually cleared:

```javascript
// Clear all deduplication caches
messageTracker.clear();
webhookUserTracker.clearCache();
nonceTracker.clear();

// Or selectively clear old entries
messageTracker.cleanOldEntries(5 * 60 * 1000); // 5 minutes
```

## Best Practices

1. **Layer Order Matters**: Check fastest operations first (ID lookup) before expensive ones (similarity)
2. **Don't Over-Deduplicate**: Some legitimate messages might look similar
3. **Monitor Performance**: Deduplication should be invisible to users
4. **Test Edge Cases**: Threads, edits, and complex reply chains need special attention
5. **Document Changes**: Deduplication logic can be subtle - document any modifications

## Future Enhancements

Potential improvements to consider:

1. **Persistent Deduplication**: Store recent messages in Redis/database
2. **Distributed Deduplication**: For multi-instance deployments
3. **ML-Based Similarity**: Use embeddings for semantic deduplication
4. **Adaptive Thresholds**: Adjust based on false positive/negative rates
5. **Channel-Specific Rules**: Different deduplication strategies per channel

The deduplication system is critical for preventing loops and ensuring reliable bot behavior. While complex, it operates transparently and efficiently to provide a smooth user experience.