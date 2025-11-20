# Authentication System

This document details Tzurot's authentication system, which manages user authorization for AI service interactions.

## Table of Contents

- [Overview](#overview)
- [Authentication Flow](#authentication-flow)
- [Security Features](#security-features)
- [Implementation Details](#implementation-details)
- [Token Management](#token-management)
- [Command Interface](#command-interface)
- [Error Handling](#error-handling)
- [Best Practices](#best-practices)

## Overview

Tzurot implements an OAuth-like authentication system that allows users to authorize the bot to make AI service requests on their behalf. This system ensures that:

1. Each user authenticates individually
2. Sensitive authorization codes are handled securely
3. Tokens expire automatically for security
4. Users can revoke access at any time

## Authentication Flow

### 1. Initiation Phase

```
User: !tz auth start
Bot: Returns authorization URL
User: Visits URL in browser
Service: Shows authorization page
User: Approves access
Service: Provides authorization code
```

### 2. Code Submission Phase

```
User: DMs bot with !tz auth code ABC123
Bot: Validates code format
Bot: Exchanges code for token
Bot: Stores encrypted token
Bot: Confirms authentication
```

### 3. Token Usage Phase

```
User: Interacts with personality
Bot: Retrieves user's token
Bot: Adds Authorization header
API: Validates token
API: Processes request
Bot: Returns response
```

## Security Features

### 1. DM-Only Code Submission

Authorization codes MUST be submitted via Direct Message:

```javascript
// In public channel
User: !tz auth code ABC123
Bot: [Deletes message immediately]
Bot: "Please submit authorization codes via DM for security"

// In DM
User: !tz auth code ABC123
Bot: "Authentication successful!"
```

### 2. Automatic Message Deletion

Messages containing authorization codes in public channels are:
- Detected immediately
- Deleted within milliseconds
- Replaced with security reminder

### 3. Token Expiration

- Tokens expire after 30 days
- Expiration is checked on each use
- Users are notified when tokens expire
- Expired tokens are automatically cleaned up

### 4. Secure Storage

- Tokens are stored in memory only
- No tokens are logged or persisted to disk
- Token data includes expiration time
- User ID maps to token data

## Implementation Details

### Core Module (`src/auth.js`)

```javascript
// Key functions
startAuthProcess(userId)     // Generates auth URL
submitAuthCode(userId, code) // Exchanges code for token
isAuthenticated(userId)      // Checks auth status
getAuthToken(userId)         // Retrieves valid token
revokeAuth(userId)          // Removes authorization
```

### Data Structure

```javascript
// Token storage format
authTokens = {
  "userId": {
    token: "encrypted_token_string",
    expiresAt: Date.now() + (30 * 24 * 60 * 60 * 1000)
  }
}
```

### Integration Points

1. **Command Handler** (`src/commands/handlers/auth.js`)
   - Processes auth subcommands
   - Enforces DM-only for codes
   - Provides user feedback

2. **AI Service** (`src/aiService.js`)
   - Checks authentication before requests
   - Adds Authorization header
   - Handles auth errors

3. **Middleware** (`src/commands/middleware/auth.js`)
   - Validates auth for protected commands
   - Provides consistent auth checking
   - Returns appropriate error messages

## Token Management

### Token Lifecycle

1. **Creation**
   - Generated upon successful code exchange
   - Includes 30-day expiration
   - Stored in memory

2. **Validation**
   - Checked on every AI request
   - Expiration verified
   - Token presence confirmed

3. **Renewal**
   - No automatic renewal
   - User must re-authenticate
   - Old token cleaned up

4. **Revocation**
   - User-initiated via command
   - Immediate effect
   - No grace period

### Expiration Handling

```javascript
// Automatic expiration check
if (tokenData.expiresAt < Date.now()) {
  delete authTokens[userId];
  throw new Error('Authentication token has expired');
}
```

## Command Interface

### `!tz auth start`

Begins the authentication process.

**Response:**
```
To authenticate with the AI service:
1. Visit this URL: https://service.example.com/auth?client_id=...
2. Approve access
3. Copy the authorization code
4. DM me with: !tz auth code YOUR_CODE
```

### `!tz auth code <code>`

Submits authorization code (DM only).

**Security:**
- Public channel messages deleted
- Code validated before exchange
- Success/failure reported

### `!tz auth status`

Checks current authentication status.

**Response Examples:**
```
✅ Authenticated (expires in 25 days)
❌ Not authenticated
⚠️ Authentication expires in 2 days
```

### `!tz auth revoke`

Removes stored authentication.

**Response:**
```
Your authentication has been revoked successfully.
```

## Error Handling

### Common Errors

1. **Invalid Authorization Code**
   ```
   Error: Invalid authorization code. Please try again.
   ```

2. **Expired Token**
   ```
   Error: Your authentication has expired. Please re-authenticate with !tz auth start
   ```

3. **No Authentication**
   ```
   Error: You need to authenticate first. Use !tz auth start
   ```

4. **Public Channel Code**
   ```
   ⚠️ Security Warning: Please submit authorization codes via DM only!
   ```

### Error Recovery

1. **Failed Code Exchange**
   - User can retry with new code
   - Previous attempts don't block
   - Clear error messages

2. **Expired Tokens**
   - Automatic cleanup
   - User prompted to re-auth
   - No service disruption

3. **Network Failures**
   - Graceful degradation
   - Informative error messages
   - Retry guidance

## Best Practices

### For Users

1. **Always use DM for codes**
   - Never paste codes in public
   - Ignore any requests for codes in channels
   - Report suspicious behavior

2. **Monitor expiration**
   - Check status periodically
   - Re-authenticate before expiration
   - Don't share authentication status

3. **Revoke when needed**
   - Remove auth if not using bot
   - Revoke if account compromised
   - Re-auth is always available

### For Developers

1. **Never log tokens**
   ```javascript
   // Bad
   logger.info(`Token: ${token}`);
   
   // Good
   logger.info('Token validation successful');
   ```

2. **Always validate expiration**
   ```javascript
   if (!tokenData || tokenData.expiresAt < Date.now()) {
     throw new Error('Invalid or expired token');
   }
   ```

3. **Handle errors gracefully**
   ```javascript
   try {
     const token = await getAuthToken(userId);
   } catch (error) {
     if (error.message.includes('expired')) {
       // Prompt re-authentication
     } else {
       // Generic error handling
     }
   }
   ```

4. **Secure code handling**
   ```javascript
   // Always delete messages with codes
   if (isPublicChannel && containsAuthCode) {
     await message.delete();
     await sendSecurityWarning();
   }
   ```

## Security Considerations

### Threat Model

1. **Code Interception**
   - Mitigated by DM-only submission
   - Public codes auto-deleted
   - Time-limited codes

2. **Token Theft**
   - Memory-only storage
   - No disk persistence
   - Automatic expiration

3. **Impersonation**
   - User ID validation
   - Discord authentication
   - No token sharing

### Future Enhancements

1. **Encryption at Rest**
   - Encrypt tokens in memory
   - Key rotation support
   - Hardware security module

2. **Multi-Factor Auth**
   - Additional verification step
   - Time-based codes
   - Backup codes

3. **Audit Logging**
   - Track auth events
   - Detect suspicious patterns
   - User activity reports

## Testing Authentication

### Manual Testing

1. **Happy Path**
   ```
   1. Run !tz auth start
   2. Visit URL
   3. Get code
   4. DM with !tz auth code CODE
   5. Verify !tz auth status
   6. Test personality interaction
   ```

2. **Error Cases**
   - Invalid code format
   - Expired token usage
   - Public channel code submission
   - Network failures

### Automated Testing

See `tests/unit/auth.test.js` for comprehensive test coverage including:
- Token lifecycle
- Expiration handling
- Error scenarios
- Security features

## Troubleshooting

### User Issues

1. **"Invalid authorization code"**
   - Ensure code copied correctly
   - Check for extra spaces
   - Try generating new code

2. **"Not authenticated" errors**
   - Run !tz auth status
   - Re-authenticate if needed
   - Check DM settings

3. **Can't submit code**
   - Ensure using DM
   - Check bot can receive DMs
   - Verify code format

### Developer Issues

1. **Token storage issues**
   - Check memory limits
   - Verify cleanup routines
   - Monitor for leaks

2. **API authentication failures**
   - Verify token format
   - Check header construction
   - Validate API endpoints

3. **Expiration problems**
   - Ensure consistent time
   - Check timezone handling
   - Verify calculation logic