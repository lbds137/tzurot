# Referenced Message Improvements

## Overview

This document details improvements to how the bot handles referenced messages (replies) in threads and regular channels, particularly with webhook-based personalities.

## Update (05/19/2025)

We found and fixed an additional issue where system prompt artifacts like "You are Lilith" would sometimes appear in responses, particularly with referenced messages. We've implemented an aggressive sanitization approach to filter out these artifacts.

## Issues Addressed

1. **Inaccurate Attribution**: When replying to webhook messages, the bot was displaying "my message" for all bot-generated content regardless of which personality sent it.

2. **Redundant Context**: When replying to recent messages from the same personality in the same thread, the bot was unnecessarily repeating context that was already visible to users.

## Implemented Improvements

### 1. Correct Attribution for Webhook Messages

The system now correctly attributes webhook messages to their respective personalities:

- **Previous behavior**: When replying to any bot message, the reference would say "Referring to my previous message: [content]"
- **New behavior**: References now say "Referring to message from [Personality Name]: [content]" showing the correct personality name

This implementation:
- Tracks webhook messages to identify which personality sent them
- Uses display name when available, falling back to technical name if needed
- Handles cases where personality information is unavailable with a generic reference

### 2. Smart Context Filtering for Recent Messages

Added intelligence to filter out redundant context in replies:

- **Previous behavior**: All replies would include the full referenced message context
- **New behavior**: Replies to messages from the same personality in the same thread/channel within the past hour will skip repeating the context

The filter applies when ALL these conditions are met:
- The message being replied to is from the same personality that's responding
- The message is in the same thread/channel
- The message was sent within the last hour

This filtering:
- Reduces repetitive context in active conversations
- Makes thread interactions more natural
- Still preserves context when it's helpful (older messages or cross-personality replies)

## Implementation Details

Key changes were made to:

1. **bot.js**: Enhanced reply handling to:
   - Identify and record which personality sent webhook messages
   - Add timestamp-based filtering for recent same-personality replies
   - Pass more complete webhook metadata to the AI service

2. **aiService.js**: Modified reference formatting to:
   - Use personality display names in reference text
   - Support various fallback options when personality information is missing

## Benefits

- **More Natural Conversations**: Thread interactions now feel more like real conversations between different personalities
- **Clear Attribution**: Users can clearly tell which personality said what in reference context
- **Reduced Redundancy**: Eliminates repetitive context in active chats

## Future Considerations

The implementation maintains compatibility with existing features while improving the quality of interactions. We may want to consider:

1. Configurable time thresholds for "recent" message detection
2. Additional personality information to enrich references
3. User-specific settings for reference formatting