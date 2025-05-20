# Authentication Security Enhancement

## Issue Description

The current authentication system has two critical security issues:

1. **Authentication Leakage**: When a user replies to a webhook message, their user ID is not properly tracked, potentially causing the system to use another user's authentication credentials. This could allow a user to inadvertently access content they should not have access to.

2. **Default Authentication Fallback**: Unauthenticated users were falling back to using the bot owner's API key, effectively "piggybacking" on the owner's account. This is a significant security issue that could potentially result in:
   - Unauthorized usage of the owner's account
   - Accumulation of usage costs on the owner's account
   - Potential access to data that should be restricted
   - Violation of API service terms of service

## Changes Implemented

### 1. Fixed Webhook Reply Authentication

- Modified `bot.js` to correctly track and pass the user ID of the person replying to webhook messages
- Added explicit user ID extraction in message handling to ensure proper authentication
- Added debugging logs to verify the correct user ID is being used
- Added user ID to webhook message options to enhance tracking and debugging

These changes ensure that when a user replies to a webhook message, the system will correctly use their own authentication token, not the token of the user who originated the conversation.

### 2. Enforced Authentication Requirement

- Modified `aiService.js` to no longer use the default API key for unauthenticated users
- Added checks in multiple places to verify user authentication before making API calls
- Added clear error messages instructing users to authenticate when attempting to use the service
- Updated both normal and problematic personality handling to enforce authentication

This ensures that only properly authenticated users can use the AI service, preventing unauthorized use of the bot owner's API key.

## Key Locations of Changes

- `/src/bot.js`: Fixed webhook reply handling and user ID tracking
- `/src/aiService.js`: Modified authentication handling and enforced auth requirements
- `/src/webhookManager.js`: Enhanced user ID logging and tracking
- `/tests/unit/webhook.reply.auth.test.js`: Added tests to verify correct authentication behavior

## Security Impact

These changes close two significant security vulnerabilities:

1. **Session Isolation**: Each user's session is now properly isolated, preventing unintentional access to another user's authenticated session
2. **Authentication Enforcement**: Users must explicitly authenticate to use the service, preventing unauthorized use of the owner's API key

## User Experience Changes

Users who have not authenticated will now receive a message directly from the bot (not from the personality) like:

```
⚠️ Authentication required. Please use `!tz auth` to set up your account before using this service.
```

This provides clear guidance on how to properly authenticate to use the service. The error message comes from the bot itself rather than from the personality, which helps users understand that this is a system requirement, not part of the AI personality's conversation.

## Additional Notes

- All users now need to authenticate to use the service
- There is no "guest mode" - authentication is required for all API interactions
- The authentication requirement is enforced at multiple levels to prevent bypassing

## Future Recommendations

1. Consider implementing a limited "guest mode" with severely restricted functionality
2. Add usage tracking by user ID to monitor API usage
3. Implement periodic authentication checks and token refresh
4. Consider rate limiting per user to prevent abuse