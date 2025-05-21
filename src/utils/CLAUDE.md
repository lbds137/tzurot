# Utilities Guidelines

This CLAUDE.md file provides guidance for working with utility functions in Tzurot.

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

## PluralKit Pattern Detection

For detecting and parsing PluralKit proxy patterns:

```javascript
const { detectProxyPattern, parseProxyTags } = require('./pluralkitPatterns');

// Check if a message uses proxy patterns
if (detectProxyPattern(message.content)) {
  const { displayName, content } = parseProxyTags(message.content);
  // Handle the proxied message
}
```

## Best Practices

1. Keep utility functions focused on a single responsibility
2. Implement thorough error handling
3. Add detailed JSDoc comments
4. Write unit tests for each utility function
5. Avoid side effects in utility functions