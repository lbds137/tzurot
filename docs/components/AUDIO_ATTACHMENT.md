# Audio URL to Discord Attachment Feature

This feature allows the bot to detect audio files (like MP3, WAV, OGG) from personality responses, download them, and reupload them directly to Discord as attachments instead of just including the URL in the message.

## How It Works

1. When an AI personality responds with a message containing any audio file URL (e.g. `https://example.com/audio.mp3`), the bot detects this URL.
2. The bot downloads the audio file from the external URL.
3. The bot uploads the file directly to Discord as an attachment in the same message.
4. The original URL in the message is replaced with a placeholder text like `[Audio: filename.mp3]`.

## Implementation Details

### New Files

- `src/utils/audioHandler.js`: A utility module that provides functions for:
  - Detecting and extracting audio URLs
  - Downloading audio files
  - Creating Discord attachments
  - Processing message content to replace URLs with attachments

### Modified Files

- `src/webhookManager.js`: Updated to use the audioHandler utility to process messages before sending them through Discord webhooks.

### Testing

- `tests/unit/audioHandler.test.js`: Tests for the audioHandler utility functions.
- `tests/unit/webhookManager.audio.test.js`: Tests for the integration of audio handling in the webhook manager.

## Technical Notes

- The feature processes audio URLs ending with common audio file extensions (.mp3, .wav, .ogg, .m4a, .flac).
- Currently, the feature only processes the first audio URL found in a message to avoid timeouts and large files.
- If the audio file cannot be downloaded for any reason (e.g., network error, timeout, etc.), the original URL will be kept in the message.
- The feature works by replacing the URL in the message with a placeholder text and adding the file as an attachment to the message.
- The code includes special handling for known domains (including Discord CDN) but works with any domain.

## Future Improvements

Possible future enhancements:
- Caching to avoid redundant downloads of the same file
- Fallback behavior for files that are too large for Discord's attachment limit