# Activated Personality Webhook Fix

## Issue Description

When a personality is activated in a channel (using `!tz activate <personality>`), it would respond to all messages in that channel. However, the bot was also processing webhook messages sent by the activated personality itself, causing an infinite loop where:

1. A user sends a message in the channel
2. The activated personality responds via a webhook
3. The bot processes this webhook message as a normal message
4. The activated personality responds to its own message
5. Steps 3-4 repeat indefinitely, creating an infinite loop of messages

This was causing activated personalities to respond to their own messages, effectively creating a conversation with themselves.

## Root Cause

The issue was in the webhook message handling logic in `bot.js`. When a webhook message was detected, the code would check if it was from one of our system's webhooks:

```javascript
if (isOwnWebhook) {
  // Don't return - process these messages normally
  logger.debug(`Processing own webhook message from: ${message.author.username}`);
} else {
  // This is not our webhook, ignore it
  logger.debug(`Ignoring webhook message - not from our system: ${message.webhookId}`);
  return;
}
```

However, it was processing all webhook messages from our system, including those sent by activated personalities. This was causing the infinite loop as the activated personality would respond to its own messages.

## Solution

The fix is to modify the webhook message handling logic to check if there's an activated personality in the channel, and if so, ignore webhook messages in that channel:

```javascript
if (isOwnWebhook) {
  // Check if there's an activated personality in this channel
  const activatedPersonality = getActivatedPersonality(message.channel.id);
  
  if (activatedPersonality) {
    // This is a webhook from one of our activated personalities - ignore it to prevent infinite loops
    logger.debug(`Ignoring own webhook message from activated personality: ${message.author.username} in channel ${message.channel.id}`);
    return;
  }
  
  // For non-activated channels, process webhook messages normally
  logger.debug(`Processing own webhook message from: ${message.author.username}`);
} else {
  // This is not our webhook, ignore it
  logger.debug(`Ignoring webhook message - not from our system: ${message.webhookId}`);
  return;
}
```

This new logic ensures that in channels with activated personalities, webhook messages (which are the personality's own responses) are ignored, breaking the infinite loop.

## Testing

A new test file has been added at `tests/unit/bot.activated.webhook.test.js` to verify this behavior:

1. It verifies that webhook messages from our system are ignored when there's an activated personality in the channel
2. It confirms that normal user messages are still processed properly

## Benefits

1. **Prevents Infinite Loops**: Activated personalities no longer respond to their own messages, preventing an infinite conversation with themselves
2. **Reduces API Usage**: Prevents unnecessary message processing and API calls
3. **Improves User Experience**: Channels with activated personalities now function as expected, with the personality only responding to actual user messages