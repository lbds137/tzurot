# Authentication Leak Fix

## Problem Description

A security issue was identified where unauthenticated users could inadvertently "piggyback" on the authentication token of another user. This occurred because:

1. The profile information fetcher only used the personality name as a cache key, without considering the user ID.
2. This created a race condition where multiple users requesting the same personality would share the same authentication context.
3. The first user's authentication token could be used for a different user's request if the timing aligned.

## Fix Implementation

The following changes were made to prevent authentication token leakage:

### 1. Profile Info Request Keying

Changed `profileInfoFetcher.js` to use a composite key that includes both personality name and user ID:

```javascript
// Before
const requestKey = profileName;

// After
const requestKey = userId ? `${profileName}:${userId}` : profileName;
```

This ensures that each user's requests are cached separately, preventing cross-user authentication sharing.

### 2. Parameter Passing

Modified `getProfileDisplayName` and `getProfileAvatarUrl` to properly pass the user ID to `fetchProfileInfo`:

```javascript
// Before
const profileInfo = await fetchProfileInfo(profileName);

// After
const profileInfo = await fetchProfileInfo(profileName, userId);
```

### 3. Context Handling

Updated the context handling to directly use the passed userId rather than relying on the rate limiter's context:

```javascript
// Before
const userId = rateLimiter.getCurrentRequestContext()?.userId || null;

// After
// Use the userId passed to this function directly, not from rate limiter context
```

### 4. Request Cleanup

Ensured proper cleanup of completed requests using the composite key:

```javascript
// Before
ongoingRequests.delete(profileName);

// After
ongoingRequests.delete(requestKey);
```

## Security Impact

These changes prevent authentication tokens from being shared across users, ensuring that:

1. Each user's authentication is isolated and used only for their own requests.
2. Unauthenticated users cannot inadvertently use another user's authentication.
3. Rate limiting and caching continue to work effectively but in a user-isolated manner.

The fix maintains performance benefits from caching while enforcing proper authentication boundaries.

## Testing

Manual testing confirms that:
- Authenticated users see proper profile pictures and display names
- Unauthenticated users do not piggyback on an authenticated user's session
- Each user's authentication is properly isolated