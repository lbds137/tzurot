# User Authorization System

## Overview

Tzurot now supports user-specific authentication with the AI service, which provides several benefits:

1. **User Identity**: Messages are sent with the user's own identity, allowing for conversation continuity and memory
2. **Per-User Rate Limits**: Rate limits apply per user rather than globally
3. **Profile Access**: The bot can access the user's public profile
4. **Feature Expansion**: Enables future features integrated with the AI service ecosystem

## How It Works

The bot uses an OAuth-like flow to obtain user-specific authorization tokens:

1. The user triggers the auth process with `!tz auth start`
2. The bot provides a link to the service authorization page
3. The user logs in and authorizes the application
4. The service provides a one-time code to the user
5. The user provides this code to the bot via DM with `!tz auth code your-code`
6. The bot exchanges the code for a long-lived auth token via the `/nonce` endpoint
7. The bot stores this token securely and uses it for API requests with the "X-App-ID" and "X-User-Auth" headers

### Security Features

- **DM-Only Authentication**: Authorization codes must be submitted via DM for security
- **Message Deletion**: If a user attempts to submit a code in a public channel, the message is immediately deleted
- **Spoiler Tag Support**: Users can use Discord spoiler tags (`||code||`) for extra security
- **Auth Requirement**: All bot commands (except `auth` and `help`) require authentication
- **Secure Redirection**: Users are directed to DMs for secure authorization process
- **Token Security**: Tokens are stored securely and never shared or displayed

## User Commands

```
!tz auth start           - Start the authorization process and get a link
!tz auth code <code>     - Submit your authorization code (DM only)
!tz auth status          - Check your current authorization status
!tz auth revoke          - Revoke your authorization
```

## Implementation Details

### 1. Token Storage

User auth tokens are stored securely in the `data/auth_tokens.json` file. Each entry contains:

- The user's Discord ID
- Their authorization token
- The timestamp when the token was created

### 2. API Request Flow

When making API requests, the system:

1. Checks if the user has a valid token
2. If yes, creates a client with the following configuration:
   ```javascript
   new OpenAI({
     apiKey: API_KEY, // API key is still required
     baseURL: apiEndpoint,
     defaultHeaders: {
       "X-App-ID": APP_ID,
       "X-User-Auth": userToken,
     },
   });
   ```
3. If no, falls back to the default API key

### 3. Security Considerations

- **DM Enforcement**: Authorization codes can only be submitted via DM for maximum security
- **Public Channel Protection**: Attempts to submit codes in public channels are immediately stopped
- **Cleanup**: Any code submission in public channels is deleted and the user is directed to DMs
- **Access Control**: Unauthenticated users are restricted to auth and help commands only
- **Token Isolation**: Tokens are stored with limited access permissions
- **Secure Exchange**: The code exchange happens server-side
- **Limited Lifespan**: Auth codes are single-use and short-lived
- **Revocation**: The system handles token revocation

## Technical Components

- `auth.js`: Core authorization module
- `commands.js`: Added `handleAuthCommand()` for user interaction with DM-only security
- `aiService.js`: Modified to use user-specific tokens for API calls
- `tests/unit/commands.auth.test.js`: Test suite for auth functionality

## Future Improvements

- Token refreshing mechanism
- Better error handling for expired tokens
- Token usage analytics
- User token management for administrators
- Improved DM fallback for users who cannot receive DMs