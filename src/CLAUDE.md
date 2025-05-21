# Source Code Guidelines

This CLAUDE.md file provides guidance for working with the core source code of Tzurot.

## Key Principles

1. **Error Prevention**: Always implement robust error handling
2. **Deduplication**: Prevent duplicate operations at all levels
3. **Modular Design**: Keep components focused on single responsibilities
4. **Caching**: Use caching strategically to reduce API calls
5. **Rate Limiting**: Respect external API limitations

## Critical Components

### AI Service (`aiService.js`)

IMPORTANT: The AI service handles several critical functions:
- Uses pendingRequests Map to prevent duplicate API calls
- Handles multimodal content (text, images, audio)
- Processes message references properly
- Manages API communication with proper error handling

When modifying this component, maintain clear error handling and API request management.

### Webhook Manager (`webhookManager.js`)

The webhook manager has complex logic for:
- Creating and caching webhooks
- Handling long messages via splitting
- Supporting fallbacks for DM channels
- Processing media attachments
- Managing rate limits and retries

Any changes must maintain this functionality and error handling.

### Conversation Manager (`conversationManager.js`)

Maintains conversation state including:
- Active personality tracking
- Message history mapping
- Auto-respond functionality

### Personality Manager (`personalityManager.js`)

Handles personality data with:
- Registration and persistence
- Alias management
- Data validation and sanitization

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

## Known Issues

Be particularly careful when modifying:
1. Media handling (image/audio support)
2. Reference message processing
3. API authentication
4. Webhook creation and caching
5. Message deduplication logic