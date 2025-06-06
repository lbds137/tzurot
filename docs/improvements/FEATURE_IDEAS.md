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
      role: "user",
      content: [
        { type: "text", text: "Check out these images" },
        { type: "image_url", image_url: { url: "https://example.com/image1.png" } }
      ]
    },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "https://example.com/image2.png" } }
      ]
    },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "https://example.com/image3.png" } }
      ]
    }
  ]
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
      role: "user",
      content: [
        { type: "text", text: "Listen to this and look at these" },
        { type: "audio_url", audio_url: { url: "https://example.com/audio.mp3" } }
      ]
    },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "https://example.com/image1.png" } }
      ]
    },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: "https://example.com/image2.png" } }
      ]
    }
  ]
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
- Implement features in priority order- **Express.js HTTP Framework Migration** - Consider migrating from custom HTTP server to Express.js for better routing, middleware support, and ecosystem
