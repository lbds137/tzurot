# Feature Ideas and Improvements

## 1. Random Personality Trigger

**Feature**: Allow users to trigger a random personality to speak

- **Command**: Could be implemented as `!tz random` or `!tz surprise`
- **Behavior**:
  - Randomly select from all activated personalities in the current channel
  - Generate a message from that personality
  - Could optionally accept a prompt: `!tz random What do you think about pizza?`
- **Considerations**:
  - Should only select from personalities the user has access to
  - Should respect channel activation status
  - Could have a cooldown to prevent spam

## 2. Enhanced Multimodal Message Handling

**Feature**: Improve handling of messages with multiple media attachments

- **Current Limitation**: Only processes first media attachment
- **Proposed Solution**:
  - When multiple media files are attached, send each as a separate message in the messages array to the AI service
  - Each media attachment becomes its own message (since AI service can only handle one media item per message)
  - Text content from the original message would accompany the first media item
  - Subsequent media items would be sent as media-only messages
- **Example Structure**:
  ```javascript
  // User sends: "Check out these images" + [image1.png, image2.png, image3.png]
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Check out these images' },
        { type: 'image_url', image_url: { url: 'https://example.com/image1.png' } },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'https://example.com/image2.png' } }],
    },
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'https://example.com/image3.png' } }],
    },
  ];
  ```
- **Implementation Notes**:
  - Update `messageHandler.js` to detect multiple attachments
  - Modify `aiService.js` to build messages array with one message per media attachment
  - Ensure proper ordering and context preservation
  - For mixed media types (e.g., audio + images), audio would be included in the first message with any text, followed by images as separate messages
- **Mixed Media Example**:
  ```javascript
  // User sends: "Listen to this and look at these" + [audio.mp3, image1.png, image2.png]
  messages: [
    {
      role: 'user',
      content: [
        { type: 'text', text: 'Listen to this and look at these' },
        { type: 'audio_url', audio_url: { url: 'https://example.com/audio.mp3' } },
      ],
    },
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'https://example.com/image1.png' } }],
    },
    {
      role: 'user',
      content: [{ type: 'image_url', image_url: { url: 'https://example.com/image2.png' } }],
    },
  ];
  ```

## 3. Personality Storage Architecture Improvements

**Feature**: Refactor personality storage to have clearer ownership and visibility models

- **Current Issue**:
  - All personalities are technically global (available to any user)
  - `!tz list` only shows personalities added by the current user
  - Creates confusion about ownership and accessibility
- **Proposed Solutions**:
  1. **Option A: True User-Specific Personalities**
     - Store personalities with explicit owner field
     - Only allow owner to activate/use their personalities
     - Add sharing mechanism if desired
  2. **Option B: Global with Better Visibility**
     - Keep personalities global but improve discoverability
     - Add `!tz list all` to see all available personalities
     - Add `!tz list mine` for user's own personalities
     - Show personality creator in list output
  3. **Option C: Hybrid Approach**
     - Support both private and public personalities
     - Add visibility flag when creating personalities
     - Default to private, allow marking as public

## Implementation Priority

1. **High Priority**: Personality storage improvements (affects core architecture)
2. **Medium Priority**: Multimodal message handling (enhances existing functionality)
3. **Low Priority**: Random personality trigger (nice-to-have feature)

## Next Steps

- Discuss preferred approach for personality storage with team
- Create detailed technical specifications for each feature
- Implement features in priority order

---

## Additional Feature Ideas (August 2025)

### 4. User Preferences System with Voice Toggle

**Feature**: User-specific preferences command system

- **Command**: `!tz preferences` or `!tz prefs`
- **Primary Use Case**: Toggle !voice prefix for personalities
- **Behavior**:
  - Store per-user preferences including voice message generation
  - Default: voice prefix ON (prepends !voice to personality messages)
  - Users can toggle this off if they don't want voice messages
  - Could expand to include timezone preferences, notification settings, etc.
- **Implementation Notes**:
  - Need persistence layer for user preferences
  - Hook into message generation to conditionally add !voice prefix
  - Consider using existing user auth infrastructure

### 5. Emoji Reaction Actions

**Feature**: Use emoji reactions on personality messages to trigger actions

- **Behavior**:
  - ℹ️ or ❓ emoji: Display stats/details about the personality
  - 🔄 emoji: Regenerate the response
  - ❌ emoji: Delete the personality message (if user has permission)
  - 📊 emoji: Show usage statistics
- **Implementation**:
  - Listen for reaction add/remove events
  - Map emojis to specific actions
  - Check permissions before executing actions
  - Store message-to-personality mapping for context

### 6. Multiple Personality Tags

**Feature**: Tag multiple personalities in one message for group responses

- **Behavior**:
  - Parse multiple @mentions in a single message
  - Queue responses from each tagged personality
  - Personalities respond in order mentioned
  - Handle rate limiting appropriately
- **Example**: "@alice @bob What do you think?" generates responses from both
- **Considerations**:
  - Rate limit handling for multiple API calls
  - Message ordering and threading
  - Cost implications of multiple AI calls

### 7. Disable Replies for Disabled Tags

**Feature**: Respect Discord's ping notification settings

- **Behavior**:
  - Check if user has notifications enabled for personality mentions
  - If ping is disabled in Discord UI, optionally skip reply
  - Could be a per-personality or global setting
- **Implementation**:
  - Hook into Discord's notification API
  - Store user preference for this behavior

### 8. Forwarded Message Support

**Feature**: Parse and handle Discord's forwarded message format

- **Behavior**:
  - Detect forwarded message structure
  - Include forwarded content in personality context
  - Properly attribute original sender
- **Implementation**:
  - Update message parsing in messageHandler.js
  - Handle forwarded embeds appropriately

### 9. Smart Reference Inclusion

**Feature**: Intelligent handling of webhook content references

- **Behavior**:
  - Track which user an AI message was replying to
  - If different user, always include reference (bypass time check)
  - Maintains conversation context across user switches
- **Implementation**:
  - Enhance conversation tracking with reply chain data
  - Store user context in message mapping

### 10. Personality Mention Stripping

**Feature**: Smart handling of @mentions in personality messages

- **Behavior**:
  - Strip @mentions at beginning/end of messages
  - Preserve @mentions in middle of sentences
  - Prevents awkward "Hi @user" at start of responses
- **Example**: "@alice hi there" → "hi there" sent to AI
- **Implementation**:
  - Regex pattern to detect position of mentions
  - Clean message before sending to AI service

### 11. Command Ordering for AI Service

**Feature**: Ensure AI service commands appear before context metadata

- **Behavior**:
  - Commands like !voice, !wack, !sleep, !reset, !web must appear first
  - Only one command per message allowed
  - Enhanced context metadata comes after command
- **Implementation**:
  - Reorder message construction in aiService.js
  - Validate command presence and position

### 12. Discord Sticker Support

**Feature**: Convert Discord stickers to images for AI processing

- **Behavior**:
  - Detect sticker attachments in messages
  - Convert static stickers to images
  - Handle animated stickers (convert to static or describe)
  - Send to AI as image content
- **Implementation**:
  - Add sticker detection in messageHandler.js
  - Implement sticker-to-image conversion
  - Update media handling pipeline

## Feature Priority Matrix

### High Impact, Low Effort

- Personality Mention Stripping (#10)
- Command Ordering (#11)
- User Preferences with Voice Toggle (#4)

### High Impact, High Effort

- Multiple Personality Tags (#6)
- Emoji Reaction Actions (#5)
- Smart Reference Inclusion (#9)

### Low Impact, Low Effort

- Forwarded Message Support (#8)
- Disable Replies for Disabled Tags (#7)

### Low Impact, High Effort

- Discord Sticker Support (#12)
