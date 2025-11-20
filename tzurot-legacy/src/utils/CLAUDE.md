# Utilities Guidelines

This CLAUDE.md file provides guidance for working with utility functions in Tzurot.

## Available Utilities

### Core Utilities
- **channelUtils.js** - Discord channel type detection and utilities
- **contentSimilarity.js** - Text similarity calculation for deduplication
- **contextMetadataFormatter.js** - Discord context metadata formatting for AI messages
- **embedBuilders.js** - Discord embed creation helpers
- **embedUtils.js** - Embed parsing and manipulation
- **errorTracker.js** - Error history and tracking system
- **pluralkitMessageStore.js** - Temporary message storage for PluralKit tracking
- **rateLimiter.js** - API rate limiting implementation
- **urlValidator.js** - URL validation and safety checks
- **webhookUserTracker.js** - Webhook-to-user association tracking

### Media Utilities (`media/`)
- **mediaHandler.js** - Central media processing coordinator
- **audioHandler.js** - Audio file download and processing
- **imageHandler.js** - Image file download and processing
- **index.js** - Media utility exports

## Media Handling

The media handling subsystem consists of:

- `media/mediaHandler.js` - Central coordinator for media processing
- `media/audioHandler.js` - Audio file processing
- `media/imageHandler.js` - Image file processing

IMPORTANT: When handling media:
1. Always check for null/undefined values
2. Validate URLs with the urlValidator
3. Handle different media types appropriately
4. Consider both webhook and DM contexts

## Common Utility Patterns

### URL Validation

```javascript
const { isValidUrl } = require('./urlValidator');

// Always validate URLs before using them
if (!isValidUrl(url)) {
  logger.warn(`Invalid URL: ${url}`);
  return null;
}
```

### Rate Limiting

The rate limiter provides throttling for external API calls:

```javascript
const RateLimiter = require('./rateLimiter');

// Create a rate limiter for a specific service
const limiter = new RateLimiter({
  maxRequests: 5,
  timeWindow: 60 * 1000, // 1 minute
});

// Use the limiter for API calls
const result = await limiter.schedule(async () => {
  return await apiCall();
});
```

### Error Tracking

The error tracker keeps a history of recent errors:

```javascript
const { trackError, getRecentErrors } = require('./errorTracker');

try {
  await riskyOperation();
} catch (error) {
  // Track the error with context
  trackError('componentName', error, {
    userId: user.id,
    operation: 'description'
  });
}
```

## Content Processing

For content similarity and deduplication:

```javascript
const { calculateSimilarity } = require('./contentSimilarity');

// Compare two text strings for similarity (0-1 score)
const similarity = calculateSimilarity(messageA, messageB);
if (similarity > 0.8) {
  logger.info('Messages are similar, likely duplicates');
}
```

## Webhook User Tracking

The webhookUserTracker helps with tracking proxy system users:

```javascript
const { registerWebhookUser, isKnownWebhookUser } = require('./webhookUserTracker');

// Register a new webhook user
registerWebhookUser(webhookId, userId);

// Check if a webhook is associated with a known user
if (isKnownWebhookUser(webhookId)) {
  // Special handling for known systems
}
```

## PluralKit Message Tracking

For tracking messages that might be processed by PluralKit:

```javascript
const pluralkitMessageStore = require('./pluralkitMessageStore');

// Store a user message (done automatically in messageHandler)
pluralkitMessageStore.store(messageId, {
  userId: message.author.id,
  channelId: message.channel.id,
  content: message.content,
  guildId: message.guild?.id,
  username: message.author.username
});

// When a message is deleted
pluralkitMessageStore.markAsDeleted(messageId);

// Find a deleted message by content (used by webhookUserTracker)
const originalMessage = pluralkitMessageStore.findDeletedMessage(content, channelId);
```

## Context Metadata Formatting

The contextMetadataFormatter provides Discord context information for AI service messages:

```javascript
const { formatContextMetadata } = require('./contextMetadataFormatter');

// Format context metadata for a Discord message
const contextInfo = formatContextMetadata(message);
// Returns: "[Discord: ServerName > #channel | 2024-07-10T15:30:45.000Z]"
```

### Format Examples

**Guild Messages:**
```
[Discord: My Server > #general | 2024-07-10T15:30:45.000Z]
```

**Direct Messages:**
```
[Discord: Direct Messages | 2024-07-10T15:30:45.000Z]
```

**Thread Messages:**
```
[Discord: My Server > #general > Thread Name | 2024-07-10T15:30:45.000Z]
```

**Forum Posts:**
```
[Discord: Help Server > #support > How to use bot? | 2024-07-10T15:30:45.000Z]
```

### Individual Functions

```javascript
const { getChannelPath, formatTimestamp } = require('./contextMetadataFormatter');

// Get channel path for different Discord channel types
const channelPath = getChannelPath(message.channel);
// Returns: "#general", "Direct Messages", "#parent > Thread Name", etc.

// Format timestamp to ISO string
const timestamp = formatTimestamp(message.createdTimestamp);
// Returns: "2024-07-10T15:30:45.000Z"
```

### Error Handling

The utility includes comprehensive error handling:
- Invalid timestamps fall back to current time
- Missing channel information uses "Unknown" placeholders
- All errors are logged with appropriate context
- Functions never throw - always return safe defaults

## When to Create New Utilities

Create a new utility when:
1. **Functionality is used in 3+ places** - If code is repeated in multiple files
2. **Logic is complex and self-contained** - If it's a non-trivial algorithm or process
3. **It's a pure function** - Takes inputs, returns outputs, no side effects
4. **It's testable in isolation** - Can be unit tested without mocking the entire app

Don't create utilities for:
1. **Single-use functions** - Keep them in the component that uses them
2. **Business logic** - This belongs in handlers or managers
3. **Stateful operations** - Utilities should be stateless

## Best Practices

1. Keep utility functions focused on a single responsibility
2. Implement thorough error handling
3. Add detailed JSDoc comments
4. Write unit tests for each utility function
5. Avoid side effects in utility functions
6. Use descriptive names that clearly indicate the function's purpose
7. Group related utilities in the same file (e.g., all embed utilities together)