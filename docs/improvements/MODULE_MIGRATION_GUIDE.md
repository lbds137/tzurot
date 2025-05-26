# Module Migration Guide

This guide helps developers understand and work with the newly refactored module structure.

## Quick Reference - What Moved Where

### From webhookManager.js
- Webhook caching → `utils/webhookCache.js`
- Message deduplication → `utils/messageDeduplication.js`
- Avatar management → `utils/avatarManager.js`
- Message formatting → `utils/messageFormatter.js`

### From aiService.js
- AI authentication → `utils/aiAuth.js`
- Content sanitization → `utils/contentSanitizer.js`
- Request management → `utils/aiRequestManager.js`
- Message formatting → `utils/aiMessageFormatter.js`

### From personalityHandler.js
- Request tracking → `utils/requestTracker.js`
- Authentication checks → `utils/personalityAuth.js`
- Thread handling → `utils/threadHandler.js`

## Using the New Modules

### Direct Imports (Recommended)

```javascript
// Instead of importing from the main files...
const { formatApiMessages } = require('./aiService');
const { getCachedWebhook } = require('./webhookManager');

// Import directly from the modules
const { formatApiMessages } = require('./utils/aiMessageFormatter');
const { getCachedWebhook } = require('./utils/webhookCache');
```

### Backward Compatibility

All functions are still available through the original files via re-exports, so existing code continues to work without changes.

## Common Patterns

### Authentication Checks

```javascript
const { checkPersonalityAuth } = require('./utils/personalityAuth');

// Check if user can use a personality
const authResult = await checkPersonalityAuth(message);
if (!authResult.isAllowed) {
  await message.reply(authResult.errorMessage);
  return;
}
```

### Request Tracking

```javascript
const requestTracker = require('./utils/requestTracker');

// Track a request to prevent duplicates
const requestKey = requestTracker.trackRequest(userId, channelId, personalityName);
if (!requestKey) {
  // Duplicate request, ignore
  return;
}

try {
  // Process request
} finally {
  requestTracker.completeRequest(requestKey);
}
```

### Message Formatting

```javascript
const { formatMessageForDiscord } = require('./utils/messageFormatter');

// Format a long message
const formattedMessages = formatMessageForDiscord(longContent, {
  maxLength: 2000,
  personality: { displayName: 'Assistant' }
});

// Send each part
for (const part of formattedMessages) {
  await channel.send(part);
}
```

## Testing with New Modules

When writing tests, import and mock the specific modules:

```javascript
// Mock specific modules
jest.mock('../utils/webhookCache');
jest.mock('../utils/personalityAuth');

const webhookCache = require('../utils/webhookCache');
const { checkPersonalityAuth } = require('../utils/personalityAuth');

// Set up mocks
webhookCache.getCachedWebhook.mockResolvedValue(mockWebhook);
checkPersonalityAuth.mockResolvedValue({ isAllowed: true });
```

## Benefits for Developers

1. **Clearer Code Organization**: Each module has a single, clear purpose
2. **Easier Testing**: Mock only what you need, not entire large files
3. **Better IntelliSense**: Smaller files mean better IDE performance
4. **Reduced Merge Conflicts**: Changes are isolated to specific modules
5. **Faster Development**: Find and modify code more quickly

## Migration Checklist

When updating existing code:

- [ ] Identify functions being imported from large files
- [ ] Find the new module containing those functions
- [ ] Update imports to use the new module directly
- [ ] Update associated tests to mock the new modules
- [ ] Run tests to ensure everything still works
- [ ] Remove any unnecessary imports

## Future Plans

The module extraction is part of a larger restructuring effort. See [MODULE_STRUCTURE_PROPOSAL.md](MODULE_STRUCTURE_PROPOSAL.md) for the comprehensive plan.