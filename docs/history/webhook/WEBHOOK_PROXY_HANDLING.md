# Webhook Proxy Handling and Thread NSFW Checking

## Overview

This document describes the implementation for handling webhook-proxied users, specifically for systems like PluralKit that use Discord webhooks to represent multiple users/personalities.

## Problem Statement

Three issues were addressed in this update:

### 1. Webhook Proxy Systems (like PluralKit)

When a user uses PluralKit or similar systems, they send a message that PluralKit quickly deletes, then PluralKit sends a webhook message on their behalf with a different username and avatar. This creates several challenges:

1. **NSFW Verification Bypass**: The webhook message doesn't have the original user's ID, causing age verification checks to fail.
2. **Missing Member Object**: Webhook messages have a null `message.member` object, causing errors in commands that check for permissions.
3. **Authentication Issues**: Webhook messages can't be properly associated with the authenticated user.

### 2. Authentication Command Security

Webhook proxy systems presented specific security concerns with authentication:

1. **Security Risk**: Allowing proxy systems to execute auth commands could create security vulnerabilities.
2. **Unclear User Identity**: Authenticating a webhook user doesn't clearly establish which real user is being authenticated.
3. **Command Handling**: Auth commands required special restrictions and guidance for webhook users.

### 3. Thread NSFW Status Checking

Discord threads inherit some properties from their parent channels, but the NSFW status wasn't being checked correctly:

1. **Missing NSFW Flag**: Threads might not have their own NSFW flag, even if their parent channel is NSFW.
2. **Verification Issues**: Commands requiring NSFW channels (like `verify`) weren't working in threads.
3. **Blocked Personalities**: Bot was refusing to activate personalities in threads of NSFW channels.

## Solution

We've implemented a multi-faceted approach to handle these issues:

### 1. Webhook User Tracker (for Proxy Systems)

A new utility (`src/utils/webhookUserTracker.js`) that:

- Identifies messages from known proxy systems like PluralKit
- Provides utilities to bypass NSFW verification for these systems
- Could track associations between webhook IDs and real user IDs (future enhancement)

### 2. Robust Permission Checks (for Proxy Systems)

Modified all commands to safely check for the existence of `message.member` before attempting to access `.permissions`:

```javascript
// Before (problematic)
if (message.member.permissions.has(PermissionFlagsBits.Administrator)) { ... }

// After (safe)
if (message.member && message.member.permissions.has(PermissionFlagsBits.Administrator)) { ... }
```

### 3. NSFW Verification Bypass (for Proxy Systems)

Implemented special handling for proxy system webhooks with improved command detection:

```javascript
// Check if this is a trusted proxy system that should bypass verification
const shouldBypass = webhookUserTracker.shouldBypassNsfwVerification(message);

// If we should bypass verification, treat as verified
const isVerified = shouldBypass ? true : auth.isNsfwVerified(message.author.id);
```

The improved verification bypass also checks if the webhook message is a command, with special handling for auth commands:

```javascript
function shouldBypassNsfwVerification(message) {
  // Fast path: if not a webhook message, no need to bypass
  if (!message || !message.webhookId) {
    return false;
  }

  // If this is a proxy system webhook, bypass verification
  if (isProxySystemWebhook(message)) {
    return true;
  }
  
  // Special case for command messages from webhooks
  // If this is a command (!tz) from a webhook, bypass verification
  const { botPrefix } = require('../../config');
  if (message.content && message.content.startsWith(botPrefix)) {
    // Check if this is an auth command - we need special handling
    if (message.content.toLowerCase().includes(`${botPrefix} auth`)) {
      // Log but don't bypass - auth commands require specific handling
      return false;
    }
    return true;
  }
  
  return false;
}
```

### 4. Secure Authentication for Webhook Users

Added special handling for authentication commands from webhook users:

```javascript
function isAuthenticationAllowed(message) {
  // If not a webhook message, authentication is always allowed
  if (!message || !message.webhookId) {
    return true;
  }
  
  // For webhook messages, deny auth for proxy systems like PluralKit
  if (isProxySystemWebhook(message)) {
    return false;
  }
  
  // For other webhooks, check if we know the real user
  const realUserId = getRealUserIdFromWebhook(message.webhookId);
  return !!realUserId;
}
```

In the command processor, we added security checks for webhook authentication:

```javascript
// For webhook messages, try to get the real user ID
if (message.webhookId) {
  // If this is a proxy system webhook, check if auth commands are restricted
  if (command === 'auth' && !webhookUserTracker.isAuthenticationAllowed(message)) {
    // Auth commands are not allowed from proxy systems - special handling
    await directSend(
      `**Authentication with Proxy Systems**\n\n` +
      `For security reasons, authentication commands can't be used through webhook systems.\n\n` +
      `Please use your regular Discord account (without the proxy) to run authentication commands.`
    );
    return true; // Return success to prevent further handling
  }
}
```

### 4. Enhanced Detection Mechanism (for Proxy Systems)

Implemented improved logic to detect messages from proxy systems using multiple methods:

```javascript
function isProxySystemWebhook(message) {
  // Must be a webhook message
  if (!message.webhookId) return false;
  
  // Check if we've already identified this webhook ID as a proxy system
  if (knownProxyWebhooks.has(message.webhookId)) {
    return true;
  }
  
  // Check if the application ID matches any known proxy systems
  // The application ID is the bot user ID that created the webhook
  if (message.applicationId && KNOWN_PROXY_WEBHOOK_IDS.includes(message.applicationId)) {
    knownProxyWebhooks.set(message.webhookId, { timestamp: Date.now() });
    return true;
  }
  
  // Check for system tag in username
  const username = message.author?.username || '';
  
  // Check if it's from a webhook user with a system tag
  const isKnownSystem = KNOWN_PROXY_SYSTEMS.some(system => 
    username.includes(system) || 
    (message.member?.nickname && message.member.nickname.includes(system))
  );
  
  if (isKnownSystem) {
    knownProxyWebhooks.set(message.webhookId, { timestamp: Date.now() });
    return true;
  }
  
  // Additional check for PluralKit-specific patterns in embeds and content
  // Many more checks that look for PK-specific patterns
  // ...
  
  return false;
}
```

### 5. Thread-Aware NSFW Checking

Created a utility function to properly check NSFW status for threads:

```javascript
function isChannelNSFW(channel) {
  if (!channel) return false;
  
  // Direct check for the channel's nsfw flag
  if (channel.nsfw === true) {
    return true;
  }
  
  // If this is a thread, check its parent channel
  if (channel.isThread && channel.isThread()) {
    try {
      const parent = channel.parent || channel.parentChannel || channel.parentTextChannel;
      
      if (parent) {
        return parent.nsfw === true;
      }
    } catch (error) {
      // Error handling
    }
  }
  
  // For forum threads, try a different approach
  if (channel.parentId) {
    try {
      const guild = channel.guild;
      if (guild) {
        const parent = guild.channels.cache.get(channel.parentId);
        if (parent) {
          return parent.nsfw === true;
        }
      }
    } catch (error) {
      // Error handling
    }
  }
  
  return false;
}
```

This function is used in all places where NSFW status is checked, ensuring consistent behavior for both regular channels and threads.

## Future Enhancements

1. **Real User Association**: Enhance the system to associate the original user with the webhook message by monitoring deleted messages just before webhook messages appear.
2. **Proxy System API Integration**: Consider direct API integration with PluralKit to get the real user ID for more accurate verification.
3. **Customizable Proxy Systems**: Allow server admins to specify trusted proxy systems beyond the default list.
4. **Account Linking**: Implement a way for proxy system users to formally link their proxy identities with their main Discord account.
5. **Secure Proxy Authentication**: Develop a specialized authentication flow for proxy systems that maintains security while allowing appropriate functionality.
4. **Webhook Caching Improvements**: Expand the webhook caching system to store more details about proxy systems and their users.
5. **Application ID Detection**: Further enhance the detection mechanism by maintaining a more comprehensive database of proxy system application IDs.

## Implementation Details

- `src/utils/webhookUserTracker.js`: Core webhook user tracking utilities for proxy systems
- `src/utils/channelUtils.js`: Thread-aware NSFW checking utility
- Modified `bot.js`: Integration with both utilities
- Modified `commands.js`: Safe permission checking, webhook authentication handling, and thread-aware NSFW checking
- Fixed authentication flow and handling for proxy systems
- Fixed `handleAuthCommand`: Added security checks and user guidance for proxy system webhooks
- Fixed `handleHelpCommand`, `handleClearErrorsCommand`, etc.: Robust handling of webhook users

## Testing

To test these changes, use a PluralKit system to:

1. Run basic commands like `help`
2. Attempt to interact with personalities in DMs
3. Verify that error handlers don't crash with null member objects
4. Attempt to use the auth command through a proxy (should receive a helpful message)
5. Verify that non-auth commands work properly through proxies

## References

- [PluralKit Documentation](https://pluralkit.me/api/)
- Discord.js webhook handling capabilities