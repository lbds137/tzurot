# Personality Re-add Fix

## Problem

When a user removes a personality and then tries to add it again, the system was incorrectly blocking the add command with this error:

```
[PROTECTION] Command has already been processed: <user_id>-<personality_name>-<personality_name>
```

This is because the `completedAddCommands` set in `messageTracker.js` was retaining the command keys indefinitely, making it impossible to re-add a personality with the same name after it was removed.

## Solution

The solution involved two main changes:

1. **Auto-expiration for completed add commands:**
   - Added a 30-minute timeout to automatically remove entries from the `completedAddCommands` set
   - This allows re-adding personalities after a reasonable waiting period

2. **Explicit cleanup when a personality is removed:**
   - Added a new method `removeCompletedAddCommand(userId, personalityName)` to the `MessageTracker` class
   - This method removes any command keys that match the pattern for the removed personality
   - The `remove.js` command handler now calls this method after successfully removing a personality
   - This allows immediate re-adding of a just-removed personality

## Implementation Details

1. `src/commands/utils/messageTracker.js`:
   - Added auto-cleanup timeout in `markAddCommandCompleted` method
   - Added new `removeCompletedAddCommand` method to explicitly clear tracking data

2. `src/commands/handlers/remove.js`:
   - Fixed parameter order for `getPersonalityByAlias` function call
   - Added call to `messageTracker.removeCompletedAddCommand` after successful removal
   - Also clears tracking for the full name if different from the alias used to remove

3. Testing:
   - Added a test script `scripts/test_readd_personalities.js` that verifies:
     - Adding a personality (adding it to the tracking)
     - Removing it (clearing the tracking)
     - Confirming it's no longer in the tracking (allowing re-adding)

## Benefits

- Users can now remove a personality and immediately add it again if needed
- Even without explicit removal, the tracking data will automatically expire after 30 minutes
- This improves the user experience for managing personality collections

## Testing

The fix was tested using a dedicated script that simulates the add-remove-readd workflow and verifies that the tracking data is properly cleared.

---
🤖 Generated with [Claude Code](https://claude.ai/code)