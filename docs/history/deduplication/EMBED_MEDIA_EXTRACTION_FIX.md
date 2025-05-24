# Embed Media Extraction Fix

**Date:** May 24, 2025  
**Issue:** Media (images) from Discord embeds were not being extracted in nested references  
**Impact:** When replying to a message that itself was a reply containing a Reddit link with an embedded image, the image was not being passed to the AI service

## Problem

The user reported that when using nested references (reply to a reply), images from Reddit embeds were not being extracted. The logs showed:

```
[EmbedUtils] linked message contains 1 embeds
[PersonalityHandler] ProcessMessageLinks returned with processed link - hasImage: false, hasAudio: false
```

The embed was being processed but converted to `[Embed Title: ...]` format instead of extracting the media URLs.

## Root Cause

The `parseEmbedsToText` function in embedUtils.js was only converting embeds to text format, not extracting media URLs from them. While there was an `extractMediaFromEmbeds` function available, it wasn't being used in the referenceHandler's processMessageLinks function.

## Solution

Enhanced the embed processing in referenceHandler.js to:

1. Continue using `parseEmbedsToText` to get the text content of embeds
2. Also call `extractMediaFromEmbeds` to extract media URLs from embeds
3. Add the extracted media URLs as `[Image: url]` or `[Audio: url]` markers

### Code Changes

In `src/handlers/referenceHandler.js`, after parsing embed text:

```javascript
// Also extract media URLs from embeds and add them as markers
if (!isFromPersonality) {
  const { extractMediaFromEmbeds } = require('../utils/embedUtils');
  const { audioUrl, imageUrl } = extractMediaFromEmbeds(linkedMessage.embeds);
  
  if (imageUrl && !result.referencedImageUrl) {
    result.referencedImageUrl = imageUrl;
    // Add the image marker to content if not already present
    if (!result.referencedMessageContent.includes(`[Image: ${imageUrl}]`)) {
      result.referencedMessageContent += `\n[Image: ${imageUrl}]`;
    }
    logger.debug(`[Bot] Extracted image from embed: ${imageUrl}`);
  }
  
  if (audioUrl && !result.referencedAudioUrl) {
    result.referencedAudioUrl = audioUrl;
    // Add the audio marker to content if not already present
    if (!result.referencedMessageContent.includes(`[Audio: ${audioUrl}]`)) {
      result.referencedMessageContent += `\n[Audio: ${audioUrl}]`;
    }
    logger.debug(`[Bot] Extracted audio from embed: ${audioUrl}`);
  }
}
```

## Testing

Created comprehensive tests to verify the fix:

1. **referenceHandler.media.test.js** - 8 tests for media marker extraction
   - Image URL extraction from [Image: url] markers
   - Audio URL extraction from [Audio: url] markers
   - Multiple media markers handling
   - Mixed media priorities
   - Edge cases and malformed markers

2. **referenceHandler.embed.test.js** - 3 tests for embed media extraction
   - Image extraction from embeds
   - Audio priority over images
   - Personality message exclusion

All tests pass successfully.

## Outcome

- Images from Discord embeds (like Reddit posts) are now properly extracted in nested references
- Media URLs are added as [Image: url] markers to the message content
- The AI service receives the media URLs and can process them appropriately
- Test coverage increased from 74.87% to 75.06%
- Total tests increased by 17 (from 1,429 to 1,446)

## Related Files

- src/handlers/referenceHandler.js - Enhanced processMessageLinks function
- src/utils/embedUtils.js - Contains extractMediaFromEmbeds function
- tests/unit/referenceHandler.media.test.js - Media marker extraction tests
- tests/unit/referenceHandler.embed.test.js - Embed media extraction tests