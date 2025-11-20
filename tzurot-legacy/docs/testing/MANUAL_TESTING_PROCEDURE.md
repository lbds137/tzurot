# Manual Testing Procedure for Message Deduplication

This document outlines a comprehensive manual testing procedure to verify that the message deduplication refactoring is working correctly. Since automated tests are not fully implemented, these steps should be followed carefully before deploying changes to production.

## Preparation

1. Create a testing branch from the current main branch:

   ```bash
   git checkout -b test/deduplication-refactor main
   ```

2. Apply the refactored changes to this branch:

   ```bash
   # Copy the modified files to the branch
   cp src/messageTracker.js path/to/branch/src/
   cp src/bot.js path/to/branch/src/
   ```

3. Start the bot in development mode:

   ```bash
   npm run dev
   ```

4. Ensure the bot is running in a test Discord server where you can safely send test messages.

5. Run the verification script:

   ```bash
   node scripts/verify_message_tracker.js
   ```

   - Ensure all tests pass before proceeding.

## Test Scenarios

### 1. Command Deduplication

**Objective**: Verify that duplicate commands are properly detected and ignored.

**Steps**:

1. Send the same command twice in rapid succession (within 5 seconds)
   ```
   !tz help
   !tz help
   ```
2. Check the logs for DUPLICATE DETECTION messages
3. Verify that only one response is received from the bot

**Expected Result**: The bot should only process and respond to the first command.

### 2. Message Reply Deduplication

**Objective**: Verify that duplicate replies are properly detected and ignored.

**Steps**:

1. Send a message to a personality (either by @mention or in a channel with an activated personality)
2. After receiving a response, try to make the bot respond to the same message again immediately
3. Check the logs for DUPLICATE OPERATION messages

**Expected Result**: The bot should only send one reply to the same message.

### 3. Multiple Channel Operation

**Objective**: Ensure that the deduplication works per channel.

**Steps**:

1. Send identical commands in two different channels in quick succession
2. Check if both commands are processed (they should be, since they're in different channels)

**Expected Result**: Commands in different channels should both be processed, even if identical.

### 4. Error Message Filtering

**Objective**: Verify that error messages are still properly filtered.

**Steps**:

1. Trigger an error condition (e.g., by intentionally making the AI service unavailable)
2. Observe the bot's behavior

**Expected Result**: Error messages should still be filtered and not displayed to users.

### 5. Memory Usage

**Objective**: Ensure that the message tracker doesn't increase memory usage over time.

**Steps**:

1. Start the bot and monitor memory usage for 10 minutes
2. Send a variety of commands and messages during this time
3. Check if memory usage stabilizes or grows continuously

**Expected Result**: Memory usage should stabilize over time, indicating that the cleanup mechanism is working.

### 6. High Volume Test

**Objective**: Test behavior under high message volume.

**Steps**:

1. Send 10+ commands in quick succession (can be different commands)
2. Observe the bot's behavior and check logs

**Expected Result**: The bot should handle all commands correctly, without errors or excessive duplication warnings.

## Monitoring

During testing, monitor the following:

1. **Console Output**: Watch for unexpected error messages or warnings
2. **Discord Messages**: Ensure the bot is responding as expected and not sending duplicates
3. **Memory Usage**: Use `process.memoryUsage()` in the console or a tool like PM2 to monitor memory

## Rollback Plan

If issues are discovered during testing:

1. Stop the bot
2. Restore the original code:
   ```bash
   cp src/bot.js.original src/bot.js
   rm src/messageTracker.js
   ```
3. Restart the bot
4. Document the specific issues encountered for future fixes

## Success Criteria

The refactoring can be considered successful if:

1. All verification script tests pass
2. All manual test scenarios are completed successfully
3. The bot responds correctly to user commands
4. No duplicate messages are observed
5. No unexpected error messages appear in the logs
6. Memory usage remains stable over time

## Production Monitoring

After implementing in production:

1. Add additional logging for the first 24 hours to monitor deduplication events
2. Check logs regularly for any unusual patterns
3. Consider implementing a simple dashboard to track deduplication metrics
