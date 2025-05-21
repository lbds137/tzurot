# Webhook Message Duplication Fix

## Issue Description

After implementing fixes for webhook verification and message echo issues, there was still a problem where a personality's response would be echoed back as if it were from a user. The flow was:

1. User sends a message (potentially referencing another message)
2. The personality replies via webhook
3. The bot incorrectly processes that webhook response as a user message
4. The personality replies again to its own response, creating a confusing conversation flow

## Root Cause

The issue was in `messageHandler.js` where the logic for identifying a webhook as belonging to our bot was extremely weak:

```javascript
// Incorrect webhook identification logic
const isOwnWebhook =
  message.author &&
  message.author.username &&
  typeof message.author.username === 'string' &&
  message.content;
```

This code was essentially saying "any webhook message with an author, a username, and content is our webhook." Furthermore, even when the system correctly identified our own webhooks, it didn't always ignore them. Instead, it had a confusing branch of code that would:

1. Check if there's an activated personality in the channel
2. Only ignore the webhook message if it came from an activated personality
3. Otherwise "process webhook messages normally" which led to the echo effect

## Fix Implementation

The solution consists of two key changes:

1. **Use Proper Webhook Identification**: 
   - Replace the weak logic with a call to the improved `webhookUserTracker.isProxySystemWebhook()` function, which properly identifies webhooks belonging to our bot

   ```javascript
   // Use our improved webhook identification logic
   const isOwnWebhook = webhookUserTracker.isProxySystemWebhook(message);
   ```

2. **Always Ignore Our Own Webhook Messages**:
   - Never process webhook messages coming from our own bot, regardless of whether there's an activated personality in the channel

   ```javascript
   if (isOwnWebhook) {
     // This is one of our own webhooks, which means it's a personality webhook we created
     // We should NEVER process these messages, as that would create an echo effect
     // where the bot responds to its own webhook messages
     logger.info(`[MessageHandler] Ignoring message from our own webhook (${message.webhookId}): ${message.author.username}`);
     return;
   }
   ```

3. **Enhanced Webhook Identification Logic**:
   - Added a third method for identifying our bot's webhooks by checking if the webhook username matches any registered personality
   - This provides a reliable fallback when webhook owner ID and application ID checks fail

## Additional Improvements

1. **Better Logging**:
   - Added clear, informative log messages to make it easier to track webhook identification
   - Log messages now include the specific method used to identify the webhook

2. **Personality Name Matching**:
   - When other identification methods fail, the system now checks if the webhook's username matches any registered personality
   - This ensures we catch all our webhooks even when Discord API doesn't provide full webhook metadata

## Related Files

- `/src/handlers/messageHandler.js` - Updated webhook identification and handling logic
- `/src/utils/webhookUserTracker.js` - Enhanced the webhook identification function with additional checks

## Preventing Future Issues

To avoid similar issues in the future:

1. Never process webhook messages that come from our own system
2. Implement multiple layers of identification for our own webhooks
3. Always have clear, informative logging around webhook processing
4. When making changes to webhook handling, consider both the "happy path" and error cases

## Benefits

This fix ensures a more natural conversation flow with webhook personalities by:

1. Preventing the bot from responding to its own webhook messages
2. Eliminating confusing "echo" responses where the bot repeats what it just said
3. Improving the reliability of webhook identification
4. Providing better debugging information in logs

This completes the series of webhook-related fixes, addressing the age verification issue, message role handling, and now the message duplication problem.