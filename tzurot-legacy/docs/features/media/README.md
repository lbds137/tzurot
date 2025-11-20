# Media & Content Features

This directory contains documentation for media handling and content processing features.

## Media Processing

- [AUDIO_ATTACHMENT](AUDIO_ATTACHMENT.md) - Audio file handling and processing
- [IMAGE_HANDLING](IMAGE_HANDLING.md) - Image file processing and display
- [MEDIA_HANDLING_SYSTEM](MEDIA_HANDLING_SYSTEM.md) - Comprehensive media system overview

## Overview

Tzurot supports rich media interactions including:

- **Audio Files**: MP3, WAV, OGG processing with metadata extraction
- **Images**: JPEG, PNG, GIF, WebP with size validation and optimization
- **Unified System**: Consistent handling across webhooks and DM channels
- **Security**: File validation, size limits, and type checking
- **Performance**: Caching and efficient processing

## Key Features

### Audio Support

- Automatic transcription for AI context
- Volume level detection and testing
- Multiple format support
- Streaming for large files

### Image Support

- Automatic AI vision integration
- Thumbnail generation
- Format conversion
- Size optimization

### Cross-Platform

- Works in Discord channels via webhooks
- Full support in DM conversations
- Handles Discord's file size limitations
- Graceful fallbacks for unsupported formats

## Related Documentation

- [Core Architecture](../../core/ARCHITECTURE.md) - System design
- [API Reference](../../core/API_REFERENCE.md) - Media endpoints
- [Testing Guide](../../testing/README.md) - Media testing patterns
