# Source Code Guidelines

This CLAUDE.md file provides guidance for working with the core source code of Tzurot.

## Key Principles

1. **Error Prevention**: Always implement robust error handling
2. **Deduplication**: Prevent duplicate operations at all levels
3. **Modular Design**: Keep components focused on single responsibilities
4. **Caching**: Use caching strategically to reduce API calls
5. **Rate Limiting**: Respect external API limitations
6. **Injectable Dependencies**: Make timers and external calls testable
7. **Security First**: Never expose tokens or bypass authentication

## Component Dependencies

```
bot.js
├── messageHandler.js
│   ├── personalityHandler.js
│   ├── referenceHandler.js
│   └── dmHandler.js
├── commandProcessor.js
│   └── commands/index.js
│       ├── middleware/auth.js
│       ├── middleware/permissions.js
│       └── middleware/deduplication.js
└── webhookManager.js
    └── aiService.js
        ├── conversationManager.js
        └── personalityManager.js
```

## Critical Components

### AI Service (`aiService.js`) - ~1700 lines

**CRITICAL: The AI service is the heart of personality interactions.**

Key responsibilities:
- **Deduplication**: Uses pendingRequests Map to prevent duplicate API calls
- **Multimodal Support**: Handles text, images, and audio content
- **Reference Processing**: Properly fetches and includes referenced messages
- **Error Handling**: Implements retry logic with exponential backoff

⚠️ **Common Pitfalls**:
- Never bypass the pendingRequests check - it prevents expensive duplicate API calls
- Always use X-User-Auth header for user-specific requests
- Maintain the multimodal content extraction logic for embeds
- Never log or expose user tokens

### Webhook Manager (`webhookManager.js`) - ~2800 lines ⚠️

**WARNING: This is the largest file in the codebase and needs refactoring.**

Critical functionality that must be preserved:
- **Webhook Caching**: NEVER create webhooks without checking cache first
- **Message Splitting**: Discord has a 2000 char limit - maintain the splitting logic
- **DM Fallback**: DMs don't support webhooks - maintain the direct send fallback
- **Media Handling**: Process attachments for both webhooks and DMs
- **Rate Limit Handling**: Implement exponential backoff on 429 errors

⚠️ **Injectable Timers Required**:
```javascript
// Current pattern that needs to be maintained:
let delayFn = (ms) => new Promise(resolve => setTimeout(resolve, ms));
```

### Conversation Manager (`conversationManager.js`) - ~570 lines

Maintains conversation state - critical for multi-turn interactions:
- **Message Mapping**: Links Discord message IDs to personality data
- **Auto-respond**: Tracks which personalities should auto-respond
- **History Management**: Maintains conversation context

⚠️ **Never clear conversation data without user action**

### Personality Manager (`personalityManager.js`) - ~690 lines

The personality system core:
- **Registration**: Validates and stores personality data
- **Persistence**: Saves to disk - maintain backward compatibility
- **Alias System**: One personality can have multiple aliases
- **Owner Validation**: Only owners can modify their personalities

⚠️ **Security Critical**: Always validate ownership before modifications

## Common Patterns

1. **Logging**: Use the structured logger:
   ```javascript
   const logger = require('./logger');
   logger.info('[Component] Action performed');
   logger.error('[Component] Error occurred', error);
   ```

2. **Error Handling**:
   ```javascript
   try {
     await someAsyncOperation();
   } catch (error) {
     logger.error(`[Component] Operation failed: ${error.message}`);
     // Add to blackout period if applicable
     // Implement fallback behavior
   }
   ```

3. **Request Tracking**:
   ```javascript
   const requestId = createUniqueId();
   pendingRequests.set(requestId, {
     timestamp: Date.now(),
     promise: asyncOperation()
   });
   ```

## Critical Patterns to Follow

### Rate Limiting Pattern
```javascript
// Always use the RateLimiter class for external APIs
const rateLimiter = new RateLimiter({
  minRequestSpacing: 3000,
  maxRetries: 5,
  cooldownPeriod: 60000
});

await rateLimiter.enqueue(async () => {
  return await externalAPICall();
});
```

### Authentication Pattern
```javascript
// Always validate user tokens before personality operations
// DDD Authentication Pattern
const { getApplicationBootstrap } = require('./application/bootstrap/ApplicationBootstrap');
const bootstrap = getApplicationBootstrap();
const authService = bootstrap.getApplicationServices().authenticationService;
const authStatus = await authService.getAuthenticationStatus(userId);
if (!authStatus.isAuthenticated) {
  throw new Error('Authentication required');
}
```

### Media Handling Pattern
```javascript
// Always validate media before processing
if (attachment) {
  const validated = await mediaHandler.validateMedia(attachment);
  if (validated.isValid) {
    const processed = await mediaHandler.processMedia(validated.media);
  }
}
```

### Deduplication Pattern
```javascript
// Always check for duplicates before processing
const messageKey = `${message.id}-${personality.name}`;
if (processedMessages.has(messageKey)) {
  logger.info('Duplicate message detected, skipping');
  return;
}
processedMessages.add(messageKey);
```

## Known Issues and Danger Zones

### 🚨 CRITICAL: Never Modify Without Understanding

1. **Media Reference Chain** (referenceHandler.js)
   - Complex logic for fetching media from referenced messages
   - Handles nested references (reply to a reply)
   - Breaking this breaks media in conversations

2. **Webhook Deduplication** (webhookManager.js)
   - Multiple layers prevent duplicate webhook messages
   - Each layer has a specific purpose
   - Removing any layer causes message spam

3. **Authentication Flow** (auth.js)
   - Token validation happens at multiple levels
   - Each check prevents different security issues
   - Never bypass for "convenience"

4. **Profile Info Caching** (ProfileInfoFetcher.js)
   - Prevents API rate limits
   - Has complex invalidation logic
   - Breaking cache = API bans

5. **Message Splitting Logic** (webhookManager.js)
   - Handles Discord's 2000 char limit
   - Preserves code blocks and formatting
   - Complex edge cases for multiline content

### ⚠️ Performance Critical Sections

1. **Webhook Creation**: Always check cache first
2. **Message History**: Implement pagination for large channels
3. **Media Processing**: Validate size limits before processing
4. **Personality Loading**: Cache in memory after disk read

### 🔒 Security Critical Sections

1. **API Key Handling**: Never log, never expose
2. **User Tokens**: Always use X-User-Auth header
3. **Owner Validation**: Check before ANY personality modification
4. **Input Sanitization**: Clean all user inputs
5. **URL Validation**: Validate all media URLs

## File Size Warnings

These files exceed recommended limits and need refactoring:
- `webhookManager.js` (2800+ lines) - Split into webhook, message, and media modules
- `aiService.js` (1700+ lines) - Extract request handling and formatting

## Testing Considerations

When modifying any component:
1. **Mock all external calls** - No real API calls in tests
2. **Use injectable timers** - See timer patterns in root CLAUDE.md
3. **Test error cases** - Every try/catch needs a test
4. **Maintain coverage** - Don't reduce test coverage

## MCP Integration for Source Code

### When to Use MCP for Source Code Review

**High-Value Scenarios:**
1. **Large Module Refactoring** - Breaking down files >1000 lines
   ```javascript
   mcp__gemini-collab__gemini_brainstorm({
     topic: "Refactor webhookManager.js (2800 lines) into focused modules",
     constraints: "Maintain backward compatibility, preserve all webhook caching and deduplication"
   })
   ```

2. **Security-Critical Code** - Authentication, token handling, data validation
   ```javascript
   mcp__gemini-collab__gemini_code_review({
     code: authenticationCode,
     focus: "security",
     language: "javascript"
   })
   ```

3. **Complex Error Handling** - Multi-layer retry logic, rate limiting
   ```javascript
   mcp__gemini-collab__gemini_test_cases({
     code_or_feature: "Rate limiter with exponential backoff and blackout periods",
     test_type: "edge cases"
   })
   ```

4. **Performance Optimization** - Caching strategies, deduplication logic
   ```javascript
   mcp__gemini-collab__gemini_explain({
     topic: "Optimal caching strategy for webhook objects with LRU eviction",
     level: "expert"
   })
   ```

### Component-Specific MCP Usage

**AI Service (`aiService.js`)**
- Review multimodal content handling for edge cases
- Validate deduplication logic for race conditions
- Check token security in request headers

**Webhook Manager (`webhookManager.js`)**
- Brainstorm module splitting strategies
- Review message splitting algorithm for Discord limits
- Validate rate limit handling implementation

**Personality System**
- Review alias resolution logic for conflicts
- Validate ownership checks for security
- Test persistence layer for data integrity

**Command System**
- Review middleware chain for proper error propagation
- Validate permission checks across all commands
- Test command routing with feature flags