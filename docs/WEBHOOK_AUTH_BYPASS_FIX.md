# Webhook Authentication Bypass Fix

## Problem Description

Webhook users (especially from proxy systems like PluralKit) were receiving "Authentication Required" messages in two different places:

1. When trying to use bot commands, due to auth checks in the command processor
2. When trying to interact with personalities, due to auth checks in the AI service

These issues occurred because:

1. The authentication bypass was not properly implemented in the command processor
2. The `isAuthenticated` variable was being set regardless of whether we should bypass authentication
3. The webhook command detection logic wasn't properly examining the command type

## Changes Made

### 1. Command Processor Authentication Bypass (First Fix)

We fixed the command processor to properly implement the webhook authentication bypass:

```javascript
// Create variable to track if we should bypass auth for webhooks
let webhookAuthBypass = false;

// For webhook messages, try to get the real user ID
if (message.webhookId) {
  // ...
  
  // For non-auth commands from webhooks, bypass verification if appropriate
  if (webhookUserTracker.shouldBypassNsfwVerification(message)) {
    logger.info(`[Commands] Bypassing authentication check for webhook command: ${command}`);
    // Set the bypass flag to true for non-auth commands
    const isAuthCommand = (command === 'auth');
    if (!isAuthCommand) {
      webhookAuthBypass = true;
      logger.info(`[Commands] Authentication bypass enabled for webhook command: ${command}`);
    }
  }
}

// Check authentication using the user ID (may be the real user behind a webhook)
// If webhookAuthBypass is true, override the authentication check
const isAuthenticated = webhookAuthBypass ? true : auth.hasValidToken(userId);
```

### 2. Enhanced Command Detection in WebhookUserTracker

We improved the command detection logic in `shouldBypassNsfwVerification` to better handle different commands:

```javascript
// Special case for command messages from webhooks
if (message.content && message.content.startsWith(botPrefix)) {
  // Extract the command from the message
  const commandText = message.content.slice(botPrefix.length).trim();
  const commandParts = commandText.split(/\\s+/);
  const primaryCommand = commandParts[0]?.toLowerCase();
  
  // List of commands that should not bypass verification
  const restrictedCommands = ['auth'];
  
  if (restrictedCommands.includes(primaryCommand)) {
    // Auth and other restricted commands require special handling
    logger.info(`[WebhookUserTracker] Restricted command '${primaryCommand}' detected from webhook, not bypassing`);
    return false;
  }
  
  // For all other commands, bypass verification
  logger.info(`[WebhookUserTracker] Bypassing verification for webhook command: ${primaryCommand}`);
  return true;
}
```

### 3. Simplified Help Command Handling

Removed the redundant help command special handling since it's now covered by the general webhook authentication bypass:

```javascript
// Special bypass for help command for webhook users - moved this inside the isAuthenticated check
// The logic is already handled by webhookAuthBypass above
```

### 4. AIService Authentication Bypass (Second Fix)

We also fixed the AIService to properly handle webhook users:

```javascript
// Pass message object to AIService for webhook detection
const aiResponse = await getAiResponse(personality.fullName, finalMessageContent, {
  userId: userId,
  channelId: message.channel.id,
  // Pass the original message object for webhook detection
  message: message,
});
```

In the AIService, we added webhook detection and bypass:

```javascript
// SECURITY UPDATE: Check if the user is authenticated
const userId = context.userId || null;

// Check if this is from a webhook that should bypass authentication
const isWebhookMessage = !!(context.message && context.message.webhookId);
let shouldBypassAuth = false;

if (isWebhookMessage) {
  shouldBypassAuth = webhookUserTracker.shouldBypassNsfwVerification(context.message);
  if (shouldBypassAuth) {
    logger.info(`[AIService] Bypassing authentication for webhook user: ${context.message.author?.username || 'unknown webhook user'}`);
  }
}

// If this is NOT a proxy system webhook that should bypass auth, check auth
if (!shouldBypassAuth && (!userId || !auth.hasValidToken(userId))) {
  logger.warn(`[AIService] Unauthenticated user attempting to access AI service: ${userId || 'unknown'}`);
  // Return special marker for bot-level error message, not from the personality
  return `${MARKERS.BOT_ERROR_MESSAGE}⚠️ Authentication required. Please use \`!tz auth\` to set up your account before using this service.`;
}
```

## Testing

Testing with webhook users confirmed that:

1. Authentication is properly bypassed for regular commands from webhook users
2. Auth commands still have the appropriate security restrictions
3. Help commands work correctly without requiring authentication
4. Interactions with personalities now work without authentication errors

## Future Considerations

1. We could add more sophisticated real user tracking behind webhooks
2. More restrictive commands could be added to the list that requires authentication
3. We could consider implementing a special authentication mechanism for proxy system users
4. Implement a consistent method for propagating webhook identity through all layers of the application
5. Consider adding a configuration option to control whether webhooks require authentication