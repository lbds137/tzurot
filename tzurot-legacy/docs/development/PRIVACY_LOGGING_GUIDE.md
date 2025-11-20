# Privacy-Aware Logging Guidelines

## Overview

This guide provides best practices for logging in Tzurot while protecting user privacy and complying with data protection regulations.

## Core Principles

1. **Never log user-generated content at INFO level or higher**
2. **Minimize personally identifiable information (PII) in logs**
3. **Use DEBUG level for diagnostic logs that may contain user data**
4. **Sanitize or mask sensitive data in error messages**

## Logging Levels and Privacy

### ❌ NEVER Log at INFO/WARN/ERROR Levels:

- Message content (`message.content`)
- User IDs in routine operations
- User tokens or authentication data
- Personal data from user profiles
- DM content or private channel messages

### ✅ OK to Log at INFO Level:

- System operations and state changes
- Command names (not arguments)
- Channel IDs (public channels only)
- Error counts and types (without user data)
- Performance metrics

### 🔍 Use DEBUG Level For:

- User IDs in diagnostic messages
- Message content for debugging
- Command arguments
- Detailed error context with user data

## Code Examples

### Bad Examples ❌

```javascript
// NEVER log message content at INFO level
logger.info(`Processing message: ${message.content}`);

// NEVER log user IDs in routine operations
logger.info(`User ${userId} executed command`);

// NEVER log sensitive data in errors
logger.error(`Auth failed for token: ${userToken}`);
```

### Good Examples ✅

```javascript
// Log operations without user data
logger.info('[CommandHandler] Processing command execution');

// Use DEBUG for diagnostic info with user data
logger.debug(`[CommandHandler] User ${userId} executed command: ${commandName}`);

// Sanitize error messages
logger.error('[Auth] Authentication failed - invalid token format');

// Log metrics without PII
logger.info(`[Metrics] Command executed successfully in ${duration}ms`);
```

## Error Handling

When logging errors that might contain user data:

```javascript
try {
  await processUserMessage(message);
} catch (error) {
  // Log error without user content
  logger.error(`[MessageHandler] Failed to process message: ${error.message}`);

  // Use DEBUG for detailed error info
  logger.debug(`[MessageHandler] Error details:`, {
    userId: message.author.id,
    channelId: message.channel.id,
    errorStack: error.stack,
  });
}
```

## Special Considerations

### PluralKit and Proxy Systems

- Be extra careful with webhook messages
- These may contain user data from proxy systems
- Apply same privacy rules to proxied content

### DM Handling

- Direct Messages are private by nature
- NEVER log DM content at INFO level or higher
- Use extra caution with DM-related errors

### Activated Channels

- Messages in activated channels are user interactions
- Apply strict privacy rules to all activated channel logs

## Enforcement

### Pre-commit Hooks

- Automated checks for common privacy violations
- Blocks commits with INFO level user data logging

### Code Review Checklist

- [ ] No message.content at INFO level or higher
- [ ] No user IDs in routine INFO logs
- [ ] No tokens or auth data in any logs
- [ ] Error messages sanitized of user data
- [ ] DEBUG level used for diagnostic user data

## Compliance Notes

- These guidelines help comply with GDPR and similar regulations
- Logs may be retained for debugging but should follow retention policies
- Production logs should be access-controlled
- Consider log rotation and automatic deletion policies

## Migration Guide

When updating existing code:

1. Search for `logger.info.*message.content`
2. Search for `logger.info.*author.id`
3. Search for `logger.error.*content`
4. Replace with appropriate logging level or sanitized version

## Tools and Scripts

Check for privacy violations:

```bash
# Run privacy audit
npm run audit:privacy

# Check specific file
rg "logger\.(info|warn|error).*message\.content" src/
```

## Questions?

If unsure about logging sensitive data:

1. Default to NOT logging it
2. Use DEBUG level if needed for diagnostics
3. Ask in code review
4. Err on the side of privacy
