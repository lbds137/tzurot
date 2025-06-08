# Multiple Media API Limitation Fix

## Problem
The current implementation combines all media items (images/audio) into a single message's content array. However, the API has a limitation: only one media item per message is allowed.

## Current Behavior
When a user replies to their own message containing media while mentioning a personality, and both messages have media:
```javascript
// Current: All media in one message
{
  role: "user",
  content: [
    { type: "text", text: "Combined text..." },
    { type: "image_url", image_url: { url: "image1.png" } }, // From current message
    { type: "image_url", image_url: { url: "image2.png" } }  // From referenced message
  ]
}
```

## Required Behavior
Split media across multiple messages:
```javascript
[
  {
    role: "user",
    content: [
      { type: "text", text: "Combined text..." },
      { type: "image_url", image_url: { url: "image1.png" } }
    ]
  },
  {
    role: "user", 
    content: [
      { type: "text", text: "Here's another image:" },
      { type: "image_url", image_url: { url: "image2.png" } }
    ]
  }
]
```

## Implementation Approach

### Option 1: Minimal Change (Recommended for now)
Only split when there are multiple media items. This preserves the current behavior for single media cases.

### Option 2: Always Split Media
Even with single media, separate it from the main text. This might be cleaner but changes more behavior.

### Option 3: Configurable Behavior
Add a configuration option to toggle between "multiple media per message" and "single media per message" modes.

## Code Changes Needed

1. **In `formatApiMessages` function (aiService.js)**:
   - After collecting all media elements, check if there are multiple
   - If multiple, create separate messages for each media item
   - The first message gets the full context text + first media
   - Subsequent messages get simple context text + their media

2. **Test Updates**:
   - Add tests for multiple media scenarios
   - Ensure single media cases still work correctly

## Considerations

1. **Message Order**: The AI will see messages in sequence. The context should be in the first message.

2. **Media Context**: Each additional media message needs some context text like "Here's another image:" or "Additional audio:".

3. **Mixed Media**: If there's both audio and image, the order matters. Currently audio takes priority.

4. **Performance**: Multiple API messages might affect response time and token usage.

## Example Scenarios

### Scenario 1: Reply with 2 images
- User posts image A with text
- User replies with image B and @mentions personality
- Result: 2 messages sent to API

### Scenario 2: Discord link with image + reply with image
- User posts Discord link (linked message has image C)
- User replies with image D and @mentions personality  
- Result: 2 messages sent to API

### Scenario 3: Multiple Discord links
- User posts multiple Discord links, each pointing to messages with images
- This could result in many images - need to consider limits

## Future Enhancements

1. **Media Limit**: Add a maximum number of media items to prevent too many API messages
2. **Media Prioritization**: Let users configure which media to prioritize
3. **Smart Grouping**: Group similar media types together