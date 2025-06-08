# Reference and Media Handling Refactor

## Current Limitations

### Nested Reference Media
- **Issue**: Media extracted from embeds in nested references is not included in AI requests
- **Cause**: `processMessageLinks` only checks for direct attachments, not media URLs that were extracted from embeds and stored as `[Image: url]` or `[Audio: url]` markers in message content
- **Impact**: When replying to a message that contains a Discord link, if that linked message has an embed with an image/thumbnail, that media won't be passed to the AI

### Architecture Complexity
The current implementation has grown organically and handles multiple scenarios with overlapping code:
- Direct message references (`message.reference`)
- Nested references (reply to a reply)
- Discord message links in content
- Media from direct attachments
- Media from embeds
- Media from referenced messages

## Proposed Refactor

### 1. Unified Reference Chain Processing
Create a recursive reference processor that can:
- Follow any chain of replies or Discord links
- Have a configurable maximum depth (e.g., `MAX_REFERENCE_DEPTH=10` in .env)
- Build a complete context tree of all referenced messages
- Extract all media from each message in the chain

### 2. Comprehensive Media Extraction
Implement a unified media extractor that handles:
- Direct attachments
- Embed images/thumbnails
- Media URLs in message content (`[Image: url]` markers)
- Media from all messages in the reference chain

### 3. Multiple Media Support
Enable sending multiple media items:
- Support arbitrary number of media items (not just first image/audio)
- Configurable limit (e.g., `MAX_MEDIA_PER_REQUEST=10` in .env)
- Send additional media as separate messages if needed
- Maintain proper context linking between messages

## Implementation Ideas

### Reference Chain Builder
```javascript
class ReferenceChainBuilder {
  constructor(maxDepth = 10) {
    this.maxDepth = maxDepth;
    this.processedMessages = new Set();
  }

  async buildChain(message, depth = 0) {
    if (depth >= this.maxDepth || this.processedMessages.has(message.id)) {
      return [];
    }
    
    this.processedMessages.add(message.id);
    const chain = [await this.extractMessageData(message)];
    
    // Process direct reference
    if (message.reference) {
      const referenced = await message.channel.messages.fetch(message.reference.messageId);
      chain.push(...await this.buildChain(referenced, depth + 1));
    }
    
    // Process Discord links in content
    const links = this.extractDiscordLinks(message.content);
    for (const link of links) {
      const linkedMessage = await this.fetchMessageFromLink(link);
      if (linkedMessage) {
        chain.push(...await this.buildChain(linkedMessage, depth + 1));
      }
    }
    
    return chain;
  }
  
  extractMessageData(message) {
    return {
      content: message.content,
      author: message.author,
      media: this.extractAllMedia(message),
      timestamp: message.createdTimestamp
    };
  }
  
  extractAllMedia(message) {
    const media = [];
    
    // Direct attachments
    for (const [_, attachment] of message.attachments) {
      media.push({
        type: this.getMediaType(attachment.contentType),
        url: attachment.url
      });
    }
    
    // Embed media
    for (const embed of message.embeds) {
      if (embed.image) media.push({ type: 'image', url: embed.image.url });
      if (embed.thumbnail) media.push({ type: 'image', url: embed.thumbnail.url });
      if (embed.video) media.push({ type: 'video', url: embed.video.url });
    }
    
    // Media markers in content
    const imageMatches = message.content.matchAll(/\[Image: ([^\]]+)\]/g);
    for (const match of imageMatches) {
      media.push({ type: 'image', url: match[1] });
    }
    
    const audioMatches = message.content.matchAll(/\[Audio: ([^\]]+)\]/g);
    for (const match of audioMatches) {
      media.push({ type: 'audio', url: match[1] });
    }
    
    return media;
  }
}
```

### Media Processor
```javascript
class MediaProcessor {
  constructor(maxMedia = 10) {
    this.maxMedia = maxMedia;
  }
  
  async processMediaForAI(referenceChain, currentMessage) {
    const allMedia = [];
    
    // Collect all media from the chain
    for (const message of referenceChain) {
      allMedia.push(...message.media);
    }
    
    // Add current message media
    allMedia.push(...this.extractAllMedia(currentMessage));
    
    // Limit and prioritize
    const prioritizedMedia = this.prioritizeMedia(allMedia).slice(0, this.maxMedia);
    
    // Build multimodal content
    return this.buildMultimodalContent(currentMessage.content, prioritizedMedia);
  }
  
  prioritizeMedia(media) {
    // Priority: audio > images > video
    // Within each type, prioritize by recency
    return media.sort((a, b) => {
      const typePriority = { audio: 3, image: 2, video: 1 };
      return typePriority[b.type] - typePriority[a.type];
    });
  }
}
```

## Quick Fix for Current Issue

For the immediate embed media issue, we could modify `processMessageLinks` to also check for media markers in the linked message content:

```javascript
// In referenceHandler.js, after handling attachments
// Extract media URLs from content markers
const imageMatches = linkedMessage.content.matchAll(/\[Image: ([^\]]+)\]/g);
for (const match of imageMatches) {
  if (!result.referencedImageUrl) {
    result.referencedImageUrl = match[1];
    logger.debug(`[Bot] Found image marker in linked message: ${match[1]}`);
  }
}

const audioMatches = linkedMessage.content.matchAll(/\[Audio: ([^\]]+)\]/g);
for (const match of audioMatches) {
  if (!result.referencedAudioUrl) {
    result.referencedAudioUrl = match[1];
    logger.debug(`[Bot] Found audio marker in linked message: ${match[1]}`);
  }
}
```

## Benefits of Refactor

1. **Cleaner Architecture**: Separation of concerns between reference traversal, media extraction, and content building
2. **More Flexible**: Easy to add new media sources or reference types
3. **Better Performance**: Avoid redundant processing with proper caching
4. **Enhanced Features**: Support for deep reference chains and multiple media items
5. **Maintainable**: Easier to test and debug individual components

## Configuration
Add to `.env`:
```
# Maximum depth for following reference chains (replies and Discord links)
MAX_REFERENCE_DEPTH=10

# Maximum number of media items to include in AI requests
MAX_MEDIA_PER_REQUEST=10
```

## Timeline
This refactor should be considered for a future major update, as it would involve:
- Rewriting significant portions of the reference handling code
- Updating the media processing pipeline
- Extensive testing to ensure backward compatibility
- Documentation updates

For now, the quick fix for embed media extraction could provide immediate value while planning for the larger refactor.