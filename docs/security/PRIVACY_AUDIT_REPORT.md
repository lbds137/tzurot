# Privacy Audit Report

## Date: 2025-06-20

This report identifies instances where sensitive user data might be logged in production.

## Findings

### 1. Message Content Logging

#### HIGH PRIORITY - Info Level Logs

**File: `src/handlers/messageHandler.js`**
- **Line 656**: `logger.info(\`Activated personality ignoring command message: ${message.content}\`);`
  - **Issue**: Logs full message content at INFO level
  - **Impact**: User messages in activated channels are logged to production logs
  - **Recommendation**: Change to DEBUG level or remove content logging

#### MEDIUM PRIORITY - Debug Level Logs

**File: `src/handlers/messageHandler.js`**
- **Line 135**: Debug log includes full message content
- **Line 216**: Debug log includes partial message content (first 20 chars)
- **Line 341**: Debug log includes full message content for commands

**Note**: Debug logs are typically not shown in production, but should still be reviewed.

### 2. User Data in PluralKit Store

**File: `src/handlers/messageHandler.js`**
- **Lines 144-152**: Stores message content temporarily for PluralKit integration
  - **Data stored**: userId, channelId, content, guildId, username
  - **Note**: This appears to be temporary in-memory storage, but should be verified

### 3. Error Messages with Context

**File: `src/utils/aiRequestManager.js`**
- **Line 202**: Logs message sample in error cases (first 100 chars)
  - **Issue**: Could log partial user messages during errors
  - **Recommendation**: Consider removing or masking message content in error logs

### 4. Authentication Token Handling

**Positive Finding**: Authentication tokens appear to be handled carefully:
- No instances found of logging full auth tokens or API keys
- Error messages reference tokens but don't log their values
- Headers with auth information are not logged at INFO level

### 5. DM Content Handling

**Positive Finding**: DM content is not specifically logged at INFO level beyond the one instance mentioned above.

## Recommendations

### Immediate Actions
1. Change line 656 in `messageHandler.js` from `logger.info` to `logger.debug`
2. Review and mask any user message content in production error logs
3. Add privacy guidelines to developer documentation

### Best Practices
1. Never log message content at INFO level or higher
2. Use DEBUG level for diagnostic logs that include user content
3. Mask or truncate sensitive data in error messages
4. Consider implementing a privacy-aware logging wrapper that automatically sanitizes sensitive fields

### Suggested Code Changes

```javascript
// Instead of:
logger.info(`Activated personality ignoring command message: ${message.content}`);

// Use:
logger.debug(`Activated personality ignoring command message: ${message.content}`);
// Or better:
logger.info(`Activated personality ignoring command message from user ${message.author.id}`);
```

## Compliance Notes

- Ensure logging practices comply with privacy regulations (GDPR, etc.)
- Consider implementing log retention policies
- Document what data is logged and for how long

## Next Steps

1. Review and implement the recommended changes
2. Add automated checks to prevent sensitive data logging
3. Update developer guidelines with privacy-aware logging practices
4. Consider implementing structured logging with field masking capabilities