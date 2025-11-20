# Media Handling System

This document describes the media handling system in the Tzurot codebase.

## Overview

The media handling system provides a unified approach to detecting, processing, and handling media (images and audio) in Discord messages. The system is designed to work with both webhook messages and direct messages, ensuring consistent behavior across different contexts.

## System Components

The media handling system is composed of three main components:

1. **Media Handler** (`/src/utils/media/mediaHandler.js`): Central module for media detection and processing
2. **Audio Handler** (`/src/utils/media/audioHandler.js`): Specialized module for audio file processing
3. **Image Handler** (`/src/utils/media/imageHandler.js`): Specialized module for image file processing

## Module Functions

### Media Handler

The Media Handler module provides the following core functionalities:

- **Detection**: Finding media in Discord messages
- **Processing**: Preparing media for AI requests (multimodal content)
- **Webhook Integration**: Converting media for webhook messages

#### Key Functions

- `detectMedia(message, messageContent, options)`: Detects media in a Discord message and formats it for AI processing
- `processMediaUrls(content)`: Processes media URLs in message content and creates appropriate attachments
- `processMediaForWebhook(content)`: Prepares media for webhook messages
- `prepareAttachmentOptions(attachments)`: Converts attachments for Discord.js message options

### Audio Handler

The Audio Handler module specializes in processing audio files and URLs:

- **Detection**: Finding audio URLs and files
- **Validation**: Verifying audio file formats
- **Downloading**: Retrieving audio files from external sources

#### Key Functions

- `hasAudioExtension(urlOrFilename)`: Checks if a URL or filename has an audio extension
- `isAudioUrl(url, options)`: Validates that a URL points to an actual audio file
- `extractAudioUrls(content)`: Detects and extracts audio URLs from text
- `downloadAudioFile(url)`: Downloads an audio file from a URL
- `processAudioUrls(content)`: Processes text to find audio URLs and prepare attachments

### Image Handler

The Image Handler module specializes in processing image files and URLs:

- **Detection**: Finding image URLs and files
- **Validation**: Verifying image file formats
- **Downloading**: Retrieving image files from external sources

#### Key Functions

- `hasImageExtension(urlOrFilename)`: Checks if a URL or filename has an image extension
- `isImageUrl(url, options)`: Validates that a URL points to an actual image file
- `extractImageUrls(content)`: Detects and extracts image URLs from text
- `downloadImageFile(url)`: Downloads an image file from a URL
- `processImageUrls(content)`: Processes text to find image URLs and prepare attachments

## Usage Examples

### Detecting Media in a Message

```javascript
const { detectMedia } = require('../utils/media');

// Example: Detect media in a Discord message
async function handleMessage(message) {
  const result = await detectMedia(message, message.content, {
    referencedAudioUrl: null,
    referencedImageUrl: null
  });
  
  // result contains:
  // - messageContent: Processed content (string or multimodal array)
  // - hasFoundAudio: Whether audio was found
  // - hasFoundImage: Whether an image was found
  // - audioUrl: URL of detected audio if any
  // - imageUrl: URL of detected image if any
  
  // Use the processed content for AI requests
  await aiService.getResponse(result.messageContent);
}
```

### Processing Media for Webhooks

```javascript
const { processMediaForWebhook, prepareAttachmentOptions } = require('../utils/media');

// Example: Process media for a webhook message
async function sendWebhookMessage(webhookClient, content) {
  // Process media in the content
  const { content: processedContent, attachments } = 
    await processMediaForWebhook(content);
  
  // Prepare attachment options for Discord.js
  const attachmentOptions = prepareAttachmentOptions(attachments);
  
  // Send the webhook message with processed content and attachments
  await webhookClient.send({
    content: processedContent,
    ...attachmentOptions
  });
}
```

## Implementation Details

### Media Detection Process

1. Check for explicitly formatted media in message (`[Audio: url]`, `[Image: url]`)
2. Check message attachments for audio or image files
3. Check message embeds for media content
4. Process any referenced media from earlier messages
5. Create multimodal content array for AI processing if media is found

### Media Processing Flow

1. Extract media URLs from content
2. Download media from external sources
3. Create Discord attachment objects
4. Replace original URLs with attachments
5. Return processed content with attachments

### Priority System

The system implements a priority mechanism:
- Audio takes precedence over images (due to API limitations)
- Explicit media indicators (`[Audio: url]`) take precedence over attachments
- Attachments take precedence over embeds
- If no media is found in the message, referenced media is used

## Best Practices

1. Always use the media handling system for consistent processing
2. Handle both media types (audio and images) in your code
3. Check for errors and provide fallbacks
4. Be aware of the priority system when multiple media types are present