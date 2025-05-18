# Message Deduplication Update Plan

## Overview

This document outlines the strategy for implementing the simplified message deduplication system. These changes are designed to be applied with minimal disruption while maintaining the core functionality.

## Implementation Steps

### Phase 1: Preparation (Current)

- ✅ Create `bot.js.simplified` with the consolidated deduplication approach
- ✅ Create tests for the new `MessageTracker` class
- ✅ Update error filtering tests to work with the new approach
- ✅ Document the changes and benefits in `MESSAGE_DEDUPLICATION_REFACTOR.md`
- ✅ Create a test script to verify deduplication behavior

### Phase 2: Testing

1. Run the existing test suite against the current implementation
   ```bash
   npm test
   ```

2. Run the new test script against the current implementation
   ```bash
   node scripts/test_deduplication.js
   ```

3. Run the new test script against the simplified implementation
   ```bash
   node scripts/test_deduplication.js simplified
   ```

4. Compare the behavior and results to ensure consistency

### Phase 3: Implementation

1. **Copy Constants to Constants.js**
   - Add any missing error patterns from bot.js to ERROR_MESSAGES in constants.js
   - Ensure all patterns from both files are consolidated

2. **Create MessageTracker Class**
   - Create a new file: `src/messageTracker.js` 
   - Extract the MessageTracker class from the simplified version
   - Add appropriate JSDoc comments
   - Export the class and a singleton instance

3. **Update Bot.js**
   - Import the MessageTracker instance
   - Replace the existing tracking mechanisms with calls to MessageTracker
   - Remove the duplicate sets, maps, and interval cleaners
   - Update prototype patches to use MessageTracker

4. **Update Tests**
   - Move the updated test file to replace the original one
   - Add any additional test cases needed

### Phase 4: Verification

1. **Manual Testing**
   - Test command processing
   - Test reply deduplication
   - Test channel message deduplication
   - Test webhook message handling
   - Test error filtering

2. **Run Automated Tests**
   ```bash
   npm test
   ```

3. **Deploy to Staging**
   - Deploy to a staging environment
   - Monitor for any unexpected behavior
   - Verify logs for deduplication events

### Phase 5: Documentation & Cleanup

1. **Update Documentation**
   - Update comments in the codebase
   - Complete the code cleanup documentation

2. **Cleanup**
   - Remove temporary files (.simplified, etc.)
   - Remove redundant code comments

## Rollback Plan

If issues are discovered after implementation:

1. **Simple Issues**
   - Fix bugs in the MessageTracker implementation
   - Add additional safeguards if needed

2. **Critical Issues**
   - Revert to the previous implementation
   - Copy back the original bot.js
   - Document the specific issues encountered

## Testing Scenarios

The following scenarios must be tested to ensure proper functionality:

1. **Basic Deduplication**
   - Reply to a message multiple times in succession
   - Send identical messages to a channel in succession
   - Ensure only the first operation succeeds

2. **Command Processing**
   - Issue the same command multiple times quickly
   - Verify it only processes once

3. **Webhook Message Handling**
   - Test error message filtering
   - Test webhook message deduplication

4. **Edge Cases**
   - Test behavior when messages are slightly different
   - Test behavior after timeout periods
   - Test behavior with various option types
   - Test behavior under high load

## Success Criteria

The implementation will be considered successful if:

1. All tests pass
2. No regressions in functionality
3. Measurable reduction in code complexity
4. No new bug reports related to message duplication
5. Memory usage remains stable or improves