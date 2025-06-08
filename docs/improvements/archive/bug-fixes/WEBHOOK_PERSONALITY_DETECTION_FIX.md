# Webhook Personality Detection Fix

## Issue Summary
When replying to a personality webhook that has a pipe character ("|") in its username (e.g., "Desidara | תשב"), the system was failing to detect the personality, reporting "0 personalities" were checked.

## Root Cause Analysis
1. **Primary Issue**: The webhook username parsing logic in `MessageHistory._getPersonalityFromWebhookUsername()` was not extracting the base name before the pipe character, causing lookup failures.
2. **Secondary Issue**: During a recent refactor, several places were incorrectly calling `listPersonalitiesForUser()` without the required userId parameter, which was replaced with `getAllPersonalities()`.
3. **Production vs Local**: The personality "Desidara" exists in production but not in local test data, masking the issue during development.

## Changes Made

### 1. MessageHistory.js
- Added base name extraction logic to handle webhook usernames with pipe characters
- Extracts text before the first pipe ("|") character and trims whitespace
- Implements multiple matching strategies in priority order:
  1. Exact match with full webhook username
  2. Exact match with extracted base name
  3. Case-insensitive match with full webhook username  
  4. Case-insensitive match with extracted base name
  5. Webhook naming pattern regex match

```javascript
// Extract the base name from webhook username (before the pipe character)
let webhookBaseName = webhookUsername;
const pipeIndex = webhookUsername.indexOf('|');
if (pipeIndex > 0) {
  webhookBaseName = webhookUsername.substring(0, pipeIndex).trim();
  logger.debug(
    `[MessageHistory] Extracted base name from webhook: "${webhookBaseName}" (from "${webhookUsername}")`
  );
}
```

### 2. Function Call Fixes
Fixed incorrect function calls from the refactor in multiple files:
- `personalityHandler.js`: Changed `listPersonalitiesForUser()` to `getAllPersonalities()`
- `referenceHandler.js`: Changed `listPersonalitiesForUser(null)` to `getAllPersonalities()`

### 3. Comprehensive Test Coverage
Created `MessageHistory.test.js` with 24 test cases covering:
- Webhook usernames with pipe characters
- Multiple pipes in usernames
- Whitespace handling
- Case-insensitive matching
- Hebrew and special characters
- Error handling
- Priority of matching strategies

## Test Results
All 24 tests pass successfully, achieving 94.73% statement coverage and 93.93% branch coverage for MessageHistory.js.

## Example Scenarios Handled
1. `"Desidara | תשב"` → Extracts "Desidara" and matches personality
2. `"TestName | System | Extra"` → Extracts "TestName" (first pipe only)
3. `"  SpacedName   |   Suffix  "` → Trims to "SpacedName"
4. `"UPPERCASE | tag"` → Matches case-insensitively with "uppercase"
5. `"Name (Test) | tag"` → Handles special regex characters properly

## Future Considerations
1. Consider adding the missing personalities (like Desidara) to local test data
2. Monitor for other webhook username formats that might need special handling
3. Consider caching webhook username → personality mappings for performance

## Related Issues
- PR #61: Fixed race condition in aiService.js causing duplicate API calls
- Import error fix: Changed '../conversationManager' to '../core/conversation'