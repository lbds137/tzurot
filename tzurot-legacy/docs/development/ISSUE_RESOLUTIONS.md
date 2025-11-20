# Issue Resolutions

This document consolidates issue summaries and their resolutions that were previously scattered in the root directory.

## DDD Command System Alias Routing Issue (2025)

### Problem Summary
The DDD command system had an issue with alias handling. Commands with aliases were not properly categorized in two critical locations, which affected feature flag routing.

### Affected Commands and Their Aliases
- **Utility Commands**:
  - `help`: aliases = ['h', '?']
  - `notifications`: aliases = ['notif', 'notify']
  - `purgbot`: aliases = ['purgebot', 'clearbot', 'cleandm']
- **Conversation Commands**:
  - `activate`: aliases = ['act']
  - `deactivate`: aliases = ['deact']
  - `autorespond`: aliases = ['ar', 'auto']
- **Personality Commands**:
  - `add`: aliases = ['create', 'new']
  - `remove`: aliases = ['delete']
- **Authentication Commands**:
  - `verify`: aliases = ['nsfw']

### Root Cause
Two locations had hardcoded command lists that only included primary command names in `CommandIntegrationAdapter.js` and `PersonalityApplicationService.js`.

### Resolution
Fixed by updating the command category mappings to include all aliases. The alias routing logic was actually working correctly - the issue was with feature flag checks not recognizing aliases.

### Testing Results
All aliases now route correctly to the DDD system when appropriate feature flags are enabled.

## Pluralkit Reply Support Fix (2025-07-09)

### Issue
Pluralkit users were unable to reply to personality messages. The bot would either:
1. Ask for authentication inappropriately (when mentions were used)
2. Completely ignore the reply (when no mentions were used)

### Root Cause
When Pluralkit processes a message:
1. It deletes the original user message
2. It sends a new message via webhook
3. The webhook message loses the Discord reply reference
4. The bot couldn't connect the webhook message back to the original reply context

### Solution Implemented

#### 1. Fixed Authentication Issue
- Updated `personalityAuth.js` to use `webhookUserTracker.getRealUserId()` instead of `message.author.id`
- This ensures authentication checks use the real user's ID, not the webhook's ID

#### 2. Created Reply Tracking System
- Added `pluralkitReplyTracker.js` to track pending replies to personality messages
- When a user replies to a personality, we store the context (user ID, content, personality)
- When a Pluralkit webhook arrives with matching content, we restore the reply context

#### 3. Updated Message Handler
- Modified `messageHandler.js` to check for pending replies when processing Pluralkit webhooks
- Associates the webhook with the real user for proper authentication
- Processes the message as a reply to the personality
- Marks original messages as handled to prevent duplicate processing

#### 4. Enhanced Reference Handler
- Updated `referenceHandler.js` to track pending replies before the delay
- This ensures we capture the context before Pluralkit deletes the original message

#### 5. Fixed Proxy Message Identification
- Updated `personalityHandler.js` to use `webhookUserTracker.isProxySystemWebhook()` for better Pluralkit detection
- This ensures Pluralkit messages are properly formatted with speaker identification in conversation history

### Files Modified
1. `/src/utils/personalityAuth.js` - Fixed authentication to use real user ID
2. `/src/utils/pluralkitReplyTracker.js` - New module for tracking pending replies
3. `/src/handlers/messageHandler.js` - Added logic to restore reply context for Pluralkit webhooks
4. `/src/handlers/referenceHandler.js` - Added tracking of pending replies
5. `/src/handlers/personalityHandler.js` - Fixed proxy message detection
6. `/src/utils/aiMessageFormatter.js` - Updated to format proxy messages without square brackets
7. Various test files - Added tests to verify the fix works correctly

### Result
- Pluralkit users can now successfully reply to personality messages
- Authentication is based on their real user ID rather than the webhook ID
- Personalities can differentiate between different Pluralkit proxies from the same Discord user
- Messages are formatted cleanly as `Name | System: message` in conversation history