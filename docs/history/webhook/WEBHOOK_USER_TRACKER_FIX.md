# Webhook User Tracker Fix

## Summary
This fix addresses an error in the WebhookUserTracker module where the incorrect function name was being imported from the personalityManager module, causing errors when processing webhook messages from systems like PluralKit.

## Issue Description
The error message in the logs showed:
```
warn: [WebhookUserTracker] Error checking if webhook belongs to our bot: listPersonalities is not a function
```

This occurred when processing webhook messages from proxy systems like PluralKit, even when they were not attempting to interact with our bot.

## Root Cause
In the `webhookUserTracker.js` file, the function was attempting to import `listPersonalities` from the personalityManager module, but this function doesn't exist. Instead, the module exports `listPersonalitiesForUser` which can be used to get all personalities when no userId is provided.

## Fix Implementation
Changed the function import in `src/utils/webhookUserTracker.js` from:
```javascript
const { listPersonalities } = require('../personalityManager');
const allPersonalities = listPersonalities();
```

To the correct function:
```javascript
const { listPersonalitiesForUser } = require('../personalityManager');
const allPersonalities = listPersonalitiesForUser(); // This returns all personalities when no userId is provided
```

## Testing
The fix was tested by running the bot in development mode and verifying that webhook messages from proxy systems like PluralKit are properly processed without errors.

## Impact
This fix ensures that the bot can correctly identify its own webhooks versus third-party proxy system webhooks, preventing unnecessary warnings in the logs and ensuring that features like message deduplication and authorization checks work correctly.