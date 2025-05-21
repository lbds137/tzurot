# Avatar URL Handling Update

## Overview

This document describes the update to the avatar URL handling in the Tzurot bot.

## Changes Made

1. Modified the `getProfileAvatarUrl` function in `profileInfoFetcher.js` to:
   - First check for the `avatar` property (new API format)
   - Fall back to `avatar_url` property (old API format) if `avatar` is not present
   - Return null if neither property is found

2. Removed the approach that used `AVATAR_URL_BASE` from `.env` file:
   - Removed the `getAvatarUrlFormat` function from `config.js`
   - Removed import of `getAvatarUrlFormat` in `profileInfoFetcher.js`
   - Removed fallback code that generated avatar URLs from profile IDs

3. Removed special test environment handling:
   - Eliminated conditional logic for `process.env.NODE_ENV === 'test'`
   - Simplified URL validation and response flow

4. Updated tests to reflect these changes:
   - Modified `getProfileAvatarUrl should return avatar URL using profile ID` test
   - Added new test for checking priority of `avatar` over `avatar_url`
   - Updated mock implementation in test file to mirror new implementation

## Rationale

These changes were needed to adapt to a change in the API structure. The API now provides avatar information in the `avatar` property instead of `avatar_url`. By prioritizing the `avatar` property while maintaining backward compatibility with `avatar_url`, the bot can work with both new and old API responses.

Removing the `AVATAR_URL_BASE` approach simplifies the codebase by eliminating unnecessary environment configuration and logic for fallback URL generation. This makes the code more straightforward and reduces potential points of failure.

## Testing

The changes have been tested with:
- Unit tests for `profileInfoFetcher.js`
- Unit tests for `webhookManager.avatar.test.js`

All tests pass, indicating that the changes maintain functionality while adapting to the new API structure.