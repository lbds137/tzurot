# Rate Limit Fix for Owner Personality Seeding

## Issue
When seeding bot owner personalities from the environment variable list, the system was consistently getting rate limited when reaching certain personalities (like "luz-or-esh"). This was causing their aliases to not be set up properly.

## Root Cause
The `seedOwnerPersonalities` function was using `Promise.all` to register all personalities in parallel. While this was faster, it caused all profile info requests to be queued up at once in the rate limiter. With the rate limiter configured for 3-second spacing between requests, having many personalities would lead to timeouts and rate limiting issues.

## Solution
Changed the personality seeding from parallel to sequential processing with explicit delays:

1. **Sequential Processing**: Instead of using `Promise.all` to register all personalities at once, we now process them one by one using a for loop.

2. **Added Delays**: Added a 5-second delay between each personality registration (except after the last one) to ensure we stay well within rate limits.

3. **Progress Tracking**: Added better logging to show progress (e.g., "Auto-seeding owner personality 3/10: personality-name").

## Code Changes

### Before
```javascript
// Create an array of promises for parallel execution
const personalityPromises = personalitiesToAdd.map(async personalityName => {
  // Register personality...
});

// Execute all registration requests in parallel
const results = await Promise.all(personalityPromises);
```

### After
```javascript
// Process personalities sequentially with delays to avoid rate limiting
const addedPersonalities = [];

for (let i = 0; i < personalitiesToAdd.length; i++) {
  const personalityName = personalitiesToAdd[i];
  
  // Register personality...
  
  // Add a delay between personality registrations to avoid rate limiting
  if (i < personalitiesToAdd.length - 1) {
    const delayMs = 5000; // 5 seconds between requests to be safe
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
}
```

## Benefits
1. **No More Rate Limiting**: The 5-second delay ensures we stay well below the rate limiter's 3-second minimum spacing requirement.
2. **Reliable Alias Setup**: All personalities now get their display names and aliases set up properly.
3. **Better Progress Visibility**: The sequential processing with progress logging makes it easier to see which personality is being processed.
4. **More Robust**: Even if one personality fails, the others will still be processed.

## Trade-offs
- **Slower Initial Setup**: With 10 personalities and 5-second delays, the initial seeding will take about 45 seconds instead of being near-instant.
- This only affects the initial bot startup when new personalities need to be added, not regular operation.

## Testing
All existing tests continue to pass, confirming the change doesn't break any functionality.