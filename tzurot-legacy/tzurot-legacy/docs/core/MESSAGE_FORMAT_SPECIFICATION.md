# Message Format Specification

## Overview

This document describes the standardized message format used by Tzurot when sending messages to AI services. The format ensures consistent structure, eliminates duplication issues, and properly handles multimodal content with references.

**Version**: 2.0  
**Last Updated**: 2025-05-22  
**Status**: Active

## Core Principles

1. **Single Message Approach**: All content (user message + references + media) is combined into exactly one message sent to the AI API
2. **Multimodal Structure**: When references or media are involved, content is always an array of typed elements
3. **Context Preservation**: Reference information is preserved in human-readable format within the text element
4. **Media Consolidation**: All media (from user and references) is included as separate elements in the content array
5. **No Duplication**: Eliminates the audio duplication bug by combining rather than separating content

## Message Structure

### Basic Structure
```json
[{
  "role": "user",
  "content": string | array
}]
```

### Content Types

#### Simple Text (No References or Media)
```json
[{
  "role": "user",
  "content": "Hello, how are you today?"
}]
```

#### Multimodal Content (References or Media Present)
```json
[{
  "role": "user", 
  "content": [
    {
      "type": "text",
      "text": "Combined user message and reference context"
    },
    {
      "type": "image_url",
      "image_url": {"url": "https://example.com/image.jpg"}
    },
    {
      "type": "audio_url", 
      "audio_url": {"url": "https://example.com/audio.mp3"}
    }
  ]
}]
```

## Content Element Types

### Text Element
```json
{
  "type": "text",
  "text": "Combined user message and reference context"
}
```

**Rules:**
- Always the first element in multimodal content arrays
- Contains user's original message text + reference context (if any)
- Reference context is appended with newline separation
- Format: `{user_message}\n{reference_context}`

### Image Element
```json
{
  "type": "image_url",
  "image_url": {
    "url": "https://example.com/image.jpg"
  }
}
```

### Audio Element
```json
{
  "type": "audio_url",
  "audio_url": {
    "url": "https://example.com/audio.mp3"
  }
}
```

## Reference Context Formatting

### User Message References
```
{author} said:
"{content}"
```

**Example:**
```
SomeUser said:
"I believe AI will transform society in profound ways."
```

### User Self-References
When a user references their own message:
```
I said:
"{content}"
```

**Example:**
```
I said:
"I think AI has some limitations we should consider."
```

### Bot Message References (Same Personality)
```
You said earlier: "{content}"
```

**Example:**
```
You said earlier: "The concept of emergence is fascinating in complex systems."
```

### Bot Message References (Different Personality)
```
{display_name} ({personality_name}) said: "{content}"
```

**Example:**
```
Albert Einstein (albert-einstein) said: "Time is relative to the observer."
```

### Media References
When referencing messages with media, special descriptive text is added:

```
This is a message referencing a message with {media_type} from {author}. {author} said:
"{cleaned_content}"
```

**Examples:**
- `This is a message referencing a message with an image from ImageUser. ImageUser said: "Check out this picture"`
- `This is a message referencing a message with audio from AudioUser. AudioUser said: "Listen to this recording"`

### Media Self-References
When referencing your own messages with media:

```
This is a message referencing a message with {media_type} from me. I said:
"{cleaned_content}"
```

**Examples:**
- `This is a message referencing a message with an image from me. I said: "Check out this picture"`
- `This is a message referencing a message with audio from me. I said: "[Audio Message]"`

## Media Handling Rules

### Media Priority in References
When a referenced message contains multiple media types:
1. **Audio takes priority** - only audio is included, images are ignored
2. Media URLs are extracted and added as separate content elements
3. Media markers are removed from the text content to avoid duplication

### Media Placeholder Generation
When referenced content becomes empty after media extraction:
- Image-only content → `"[Image]"`
- Audio-only content → `"[Audio Message]"`

### Media Element Ordering
1. Text element (always first)
2. User's original media elements (preserved in original order)
3. Referenced media elements

## Scenario Examples

### 1. Simple Messages (No References)

#### 1.1 Simple Text Message
**Input:** `"Hello, how are you today?"`

**Output:**
```json
[{
  "role": "user",
  "content": "Hello, how are you today?"
}]
```

#### 1.2 Text + Image (No References)
**Input:** 
```json
[
  {"type": "text", "text": "What do you see in this image?"},
  {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
]
```

**Output:**
```json
[{
  "role": "user",
  "content": [
    {"type": "text", "text": "What do you see in this image?"},
    {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
  ]
}]
```

#### 1.3 Text + Audio (No References)
**Input:**
```json
[
  {"type": "text", "text": "Please transcribe this audio"},
  {"type": "audio_url", "audio_url": {"url": "https://example.com/audio.mp3"}}
]
```

**Output:**
```json
[{
  "role": "user",
  "content": [
    {"type": "text", "text": "Please transcribe this audio"},
    {"type": "audio_url", "audio_url": {"url": "https://example.com/audio.mp3"}}
  ]
}]
```

#### 1.4 Text + Image + Audio (No References)
**Input:**
```json
[
  {"type": "text", "text": "Compare this image and audio"},
  {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}},
  {"type": "audio_url", "audio_url": {"url": "https://example.com/audio.mp3"}}
]
```

**Output:**
```json
[{
  "role": "user",
  "content": [
    {"type": "text", "text": "Compare this image and audio"},
    {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}},
    {"type": "audio_url", "audio_url": {"url": "https://example.com/audio.mp3"}}
  ]
}]
```

### 2. Text Messages with References

#### 2.1 Text Referencing User Text
**Input:**
```json
{
  "messageContent": "What do you think about this opinion?",
  "referencedMessage": {
    "content": "I believe AI will transform society in profound ways.",
    "author": "SomeUser",
    "isFromBot": false
  }
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [{
    "type": "text",
    "text": "What do you think about this opinion?\nSomeUser said:\n\"I believe AI will transform society in profound ways.\""
  }]
}]
```

#### 2.2 Text Referencing Bot Text (Same Personality)
**Input:**
```json
{
  "messageContent": "Can you elaborate on that point?",
  "referencedMessage": {
    "content": "The concept of emergence is fascinating in complex systems.",
    "author": "Albert Einstein",
    "isFromBot": true,
    "personalityName": "albert-einstein",
    "displayName": "Albert Einstein"
  }
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [{
    "type": "text",
    "text": "Can you elaborate on that point?\nYou said earlier: \"The concept of emergence is fascinating in complex systems.\""
  }]
}]
```

#### 2.3 Text Referencing Bot Text (Different Personality)
**Input:**
```json
{
  "messageContent": "What do you think about Einstein's view?",
  "referencedMessage": {
    "content": "Time is relative to the observer.",
    "author": "Albert Einstein",
    "isFromBot": true,
    "personalityName": "albert-einstein",
    "displayName": "Albert Einstein"
  }
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [{
    "type": "text",
    "text": "What do you think about Einstein's view?\nAlbert Einstein (albert-einstein) said: \"Time is relative to the observer.\""
  }]
}]
```

### 3. Text Messages Referencing Media

#### 3.1 Text Referencing User Image
**Input:**
```json
{
  "messageContent": "What can you tell me about this image?",
  "referencedMessage": {
    "content": "Check out this picture [Image: https://example.com/image.jpg]",
    "author": "ImageUser",
    "isFromBot": false
  }
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "What can you tell me about this image?\nThis is a message referencing a message with an image from ImageUser. ImageUser said:\n\"Check out this picture\""
    },
    {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
  ]
}]
```

#### 3.2 Text Referencing User Audio (Self-Reference)
**Input:**
```json
{
  "messageContent": "Let me try this again with better context:",
  "referencedMessage": {
    "content": "[Audio Message] [Audio: https://example.com/my-audio.mp3]",
    "author": "CurrentUser",
    "isFromBot": false
  },
  "userName": "CurrentUser"
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "Let me try this again with better context:\nThis is a message referencing a message with audio from me. I said:\n\"[Audio Message]\""
    },
    {"type": "audio_url", "audio_url": {"url": "https://example.com/my-audio.mp3"}}
  ]
}]
```

### 4. Multimodal Messages with References

#### 4.1 Image + Text Referencing User Audio
**Input:**
```json
{
  "messageContent": [
    {"type": "text", "text": "This image relates to the audio. What do you think?"},
    {"type": "image_url", "image_url": {"url": "https://example.com/my-image.jpg"}}
  ],
  "referencedMessage": {
    "content": "Listen to this recording [Audio: https://example.com/audio.mp3]",
    "author": "AudioUser",
    "isFromBot": false
  }
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "This image relates to the audio. What do you think?\nThis is a message referencing a message with audio from AudioUser. AudioUser said:\n\"Listen to this recording\""
    },
    {"type": "image_url", "image_url": {"url": "https://example.com/my-image.jpg"}},
    {"type": "audio_url", "audio_url": {"url": "https://example.com/audio.mp3"}}
  ]
}]
```

#### 4.2 Audio + Text Referencing User Image
**Input:**
```json
{
  "messageContent": [
    {"type": "text", "text": "My audio response to your image"},
    {"type": "audio_url", "audio_url": {"url": "https://example.com/my-audio.mp3"}}
  ],
  "referencedMessage": {
    "content": "Check this out [Image: https://example.com/image.jpg]",
    "author": "ImageUser",
    "isFromBot": false
  }
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "My audio response to your image\nThis is a message referencing a message with an image from ImageUser. ImageUser said:\n\"Check this out\""
    },
    {"type": "audio_url", "audio_url": {"url": "https://example.com/my-audio.mp3"}},
    {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
  ]
}]
```

#### 4.3 Complex: Multiple Media Referencing Multiple Media
**Input:**
```json
{
  "messageContent": [
    {"type": "text", "text": "Here is my multimodal response to your content"},
    {"type": "image_url", "image_url": {"url": "https://example.com/response-image.jpg"}},
    {"type": "audio_url", "audio_url": {"url": "https://example.com/response-audio.mp3"}}
  ],
  "referencedMessage": {
    "content": "Mixed content: [Image: https://example.com/original-image.jpg] and [Audio: https://example.com/original-audio.mp3]",
    "author": "MediaUser",
    "isFromBot": false
  }
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "Here is my multimodal response to your content\nThis is a message referencing a message with audio from MediaUser. MediaUser said:\n\"Mixed content:  and\""
    },
    {"type": "image_url", "image_url": {"url": "https://example.com/response-image.jpg"}},
    {"type": "audio_url", "audio_url": {"url": "https://example.com/response-audio.mp3"}},
    {"type": "audio_url", "audio_url": {"url": "https://example.com/original-audio.mp3"}}
  ]
}]
```

### 5. Self-Reference Scenarios

#### 5.1 User Replying to Own Text Message
**Input:**
```json
{
  "messageContent": "Actually, let me clarify that point",
  "referencedMessage": {
    "content": "I think AI has some limitations we should consider.",
    "author": "CurrentUser",
    "isFromBot": false
  },
  "userName": "CurrentUser"
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [{
    "type": "text",
    "text": "Actually, let me clarify that point\nI said:\n\"I think AI has some limitations we should consider.\""
  }]
}]
```

#### 5.2 User Replying to Own Audio Message
**Input:**
```json
{
  "messageContent": "Let me add more context to this audio",
  "referencedMessage": {
    "content": "[Audio Message] [Audio: https://example.com/my-recording.mp3]",
    "author": "CurrentUser",
    "isFromBot": false
  },
  "userName": "CurrentUser"
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "Let me add more context to this audio\nThis is a message referencing a message with audio from me. I said:\n\"[Audio Message]\""
    },
    {
      "type": "audio_url",
      "audio_url": {"url": "https://example.com/my-recording.mp3"}
    }
  ]
}]
```

### 6. Edge Cases

#### 6.1 Empty Referenced Content
**Input:**
```json
{
  "messageContent": "What was that about?",
  "referencedMessage": {
    "content": "",
    "author": "SomeUser",
    "isFromBot": false
  }
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [{
    "type": "text",
    "text": "What was that about?\nSomeUser said:\n\"\""
  }]
}]
```

#### 6.2 Referenced Message with Only Media (No Text)
**Input:**
```json
{
  "messageContent": "Interesting file",
  "referencedMessage": {
    "content": "[Image: https://example.com/image.jpg]",
    "author": "MediaUser",
    "isFromBot": false
  }
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "Interesting file\nThis is a message referencing a message with an image from MediaUser. MediaUser said:\n\"[Image]\""
    },
    {"type": "image_url", "image_url": {"url": "https://example.com/image.jpg"}}
  ]
}]
```

#### 6.3 Multiple Media in Referenced Message (Audio Priority)
**Input:**
```json
{
  "messageContent": "Tell me about all this content",
  "referencedMessage": {
    "content": "Here's everything: [Image: https://example.com/img1.jpg] some text [Audio: https://example.com/audio.mp3] more text [Image: https://example.com/img2.jpg]",
    "author": "MediaUser",
    "isFromBot": false
  }
}
```

**Output:**
```json
[{
  "role": "user",
  "content": [
    {
      "type": "text",
      "text": "Tell me about all this content\nThis is a message referencing a message with audio from MediaUser. MediaUser said:\n\"Here's everything:  some text  more text\""
    },
    {"type": "audio_url", "audio_url": {"url": "https://example.com/audio.mp3"}}
  ]
}]
```

**Note**: When multiple media types exist, audio takes priority over images. Only the first audio URL is included, and all image URLs are ignored.

## Implementation Details

### Self-Reference Detection
The system detects when a user is replying to their own message by comparing:
- `content.userName` with `content.referencedMessage.author`

This enables proper context formatting to avoid awkward third-person references.

### Media URL Extraction
Media URLs are extracted using regex patterns:
- Images: `/\[Image: (https?:\/\/[^\s\]]+)\]/g`
- Audio: `/\[Audio: (https?:\/\/[^\s\]]+)\]/g`

### Content Sanitization
All text content is sanitized to remove control characters while preserving:
- Newlines (`\n`)
- Standard Unicode characters
- Quotes and backslashes

### Error Handling
- Invalid media URLs are logged but don't break message processing
- Missing reference data falls back to minimal context
- Empty content is handled gracefully with placeholder text

## Compatibility

### AI Service Requirements
This format is designed to work with AI services that support:
- OpenAI-compatible message structure
- Multimodal content arrays
- `text`, `image_url`, and `audio_url` content types

### Version History
- **v1.0**: Original multi-message format (deprecated due to duplication issues)
- **v2.0**: Current single-message format with combined content (active)

## Testing

Comprehensive test coverage exists for all scenarios in:
- `tests/unit/aiService.reference.test.js`
- `tests/unit/bot.referenced.media.test.js` 
- `tests/unit/bot.message.reference.test.js`

Test scenarios cover all 17 documented examples:
- **Simple Messages**: Text, Text+Image, Text+Audio, Text+Image+Audio (4 scenarios)
- **Text with References**: User text, same personality, different personality (3 scenarios)
- **Text with Media References**: User image, user audio (2 scenarios)
- **Multimodal with References**: Image+text→audio, audio+text→image, complex multi-media (3 scenarios)
- **Self-References**: Own text, own audio (original bug scenario) (2 scenarios)
- **Edge Cases**: Empty content, media-only messages, multiple media priority (3 scenarios)

## Related Documentation

- [Audio Duplication Bug Fix](../history/AUDIO_DUPLICATION_FIX.md)
- [Message Deduplication System](../components/MESSAGE_HANDLING_SYSTEM.md)
- [Multimodal Content Handling](../components/MEDIA_HANDLING_SYSTEM.md)