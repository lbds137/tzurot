# Image Handling in Personality Responses

## Overview

This document describes the implementation of image handling in the Tzurot Discord bot. The feature allows the bot to detect image URLs in personality responses, download the images, and upload them directly to Discord as attachments while removing the original URL from the message text.

## Implementation

The implementation follows the same pattern as the existing audio handling:

1. **Detection**: Identifying image URLs in the personality's response.
2. **Download**: Retrieving the image file from the source URL.
3. **Attachment**: Converting the downloaded image to a Discord attachment.
4. **Message Modification**: Removing the image URL from the message content and attaching the image instead.

## Key Components

### 1. `imageHandler.js`

A new utility module in the `src/utils` directory, modeled after the existing `audioHandler.js`. It provides functions for:

- Detecting image URLs in text (`extractImageUrls`)
- Validating image URLs (`isImageUrl`)
- Downloading images (`downloadImageFile`)
- Creating Discord attachments (`createDiscordAttachment`)
- Processing image URLs in message content (`processImageUrls`)

### 2. Updated `webhookManager.js`

The webhook manager now processes both audio and image URLs in personality responses, with the following enhancements:

- Integrates with both `audioHandler` and `imageHandler`
- Prioritizes audio over images (if both are present in a response)
- Handles downloading and attaching media files
- Modifies message content to remove processed URLs

## Testing

Tests have been created to verify the functionality of the image handler:

- Unit tests for detecting image URLs
- Unit tests for downloading and processing images
- Unit tests for creating Discord attachments
- Unit tests for handling edge cases and errors

## Example Flow

1. A personality responds with: "Here's a picture of what I'm describing: https://example.com/image.jpg"
2. The `webhookManager` detects the image URL via `imageHandler.extractImageUrls()`
3. The image is downloaded using `imageHandler.downloadImageFile()`
4. A Discord attachment is created with `imageHandler.createDiscordAttachment()`
5. The URL is removed from the message content
6. The message is sent to Discord with the attachment: "Here's a picture of what I'm describing: " + [IMAGE]

## Advantages

- Cleaner responses without long URLs
- Images appear directly in Discord without requiring clicks
- Cached locally for faster future access
- Works with a variety of image formats (jpg, png, gif, webp, etc.)
- Handles both Discord CDN URLs and external image URLs
- Prioritizes audio attachments over images when both are present

## Future Improvements

- Support for multiple image attachments in a single message
- Better error handling and recovery for failed downloads
- Intelligent processing of image dimensions for better embedding
- Support for animated GIFs and other special format handling