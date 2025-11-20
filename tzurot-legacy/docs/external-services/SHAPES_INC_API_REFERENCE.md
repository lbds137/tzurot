# Shapes.inc API Reference

## Overview

Shapes.inc provides two distinct APIs with dramatically different capabilities:

- **Public API**: Limited profile information, freely accessible
- **Private API**: Complete personality data, requires session authentication

This reference documents both APIs based on reverse engineering and analysis.

## Authentication

### Public API
- **Base URL**: `https://api.shapes.inc/` or `https://shapes.inc/api/`
- **Authentication**: None required
- **Rate Limits**: Unknown, appears generous

### Private API
- **Authentication**: Session cookies required
- **Access Method**: Users must manually export cookies from browser
- **Sustainability**: Not viable for production use
- **Security**: Cookies contain sensitive `connect.sid` and `_csrf` tokens

## Public API Endpoints

### Get Public Shape Profile
```
GET /shapes/public/{username}
GET /api/public/shapes/{username}
```

Returns basic personality profile information.

#### Response Structure
```json
{
  "id": "uuid",
  "name": "Display Name",
  "username": "kebab-case-identifier",
  "search_description": "Detailed character description",
  "search_tags_v2": ["array", "of", "tags"],
  "created_ts": 1234567890,
  "user_count": 12345,
  "message_count": 678910,
  "error_message": "Custom error message",
  "wack_message": "Alternative error message",
  "enabled": true,
  "shape_settings": {
    "shape_initial_message": "Greeting message",
    "status_type": "custom|listening|playing",
    "status": "Status text",
    "appearance": "Physical description (often empty)"
  },
  "avatar_url": "https://files.shapes.inc/...",
  "avatar": "Same as avatar_url",
  "banner": "https://files.shapes.inc/...",
  "allow_user_engine_override": true,
  "allow_multiple_messages": true|false,
  
  // Optional fields (vary by personality)
  "tagline": "Short description",
  "typical_phrases": ["catchphrase1", "catchphrase2"],
  "example_prompts": ["starter1", "starter2"],
  "screenshots": [
    {
      "id": 1234567890,
      "url": "https://files.shapes.inc/...",
      "caption": "Screenshot description"
    }
  ],
  "category": "meme|other|null",
  "custom_category": "User-defined category",
  "character_universe": "Source material",
  "character_background": "Backstory",
  "discord_invite": "https://discord.gg/...",
  "source_material": [
    {
      "title": "Reference name",
      "url": "https://..."
    }
  ]
}
```

### Limitations of Public API
- **No AI configuration**: Missing prompts, model settings
- **No voice data**: Missing ElevenLabs voice IDs
- **No operational data**: Cannot generate responses
- **Read-only**: No modification capabilities

## Private API (Undocumented)

### Authentication Requirements
```javascript
// Required cookies (obtained from browser)
{
  'connect.sid': 's%3A...',  // Session ID
  '_csrf': '...',            // CSRF token
  'uuid_value': '...'        // User identifier
}
```

### Short-Term Memory (STM) Endpoint
```
GET /api/shapes/{shape_id}/chat/history?limit={limit}&shape_id={shape_id}
GET /api/shapes/{shape_id}/chat/history?limit={limit}&before_ts={timestamp}&shape_id={shape_id}
```

Returns the rolling context window for active conversations.

#### Parameters
- `limit`: Number of messages to return (max 50)
- `before_ts`: Unix timestamp to fetch messages before (for pagination)
- `shape_id`: The personality UUID

#### Response Structure
```json
[
  {
    "id": "message-uuid",
    "reply": "AI response text (null for user messages)",
    "message": "User message text (null for AI responses)",
    "ts": 1749880055.40032,  // Unix timestamp with microseconds
    "voice_reply_url": "https://files.shapes.inc/voice-file.mp3",
    "attachment_url": "https://files.shapes.inc/attachment.jpg",
    "attachment_type": "image/png|audio/mp3|null",
    "regenerated_replies": [],  // Array of previous regenerations
    "fallback_model_used": false
  }
]
```

#### Key Features
- **Context Window**: Returns up to 50 messages per request
- **Timestamp-based Pagination**: Use `before_ts` to fetch older messages
- **Rolling Access**: Can access full conversation history by paginating backwards
- **Configurable Limits**: STM window size is personality-specific (e.g., 50 messages)
- **Dual Message Types**: User messages have `message` field, AI has `reply`
- **Voice Synthesis**: AI responses can include generated voice URLs
- **Attachments**: Supports images and audio with type tracking
- **Rich Text**: Includes Discord emotes and formatting
- **Regeneration History**: Tracks if responses were regenerated

#### Message Content Examples
1. **Text with Discord Emotes**: 
   ```
   "My love! <:heart_demon:774017016423120937>"
   ```

2. **Image Attachments**: Include AI-generated descriptions
   ```
   "look at this image: ```Description of image```"
   ```

3. **Audio Messages**: Voice notes with transcriptions
   ```
   "[Audio Message]\"Transcribed text...\""
   ```

#### Content Patterns Observed
From analyzing actual chat history, shapes.inc supports:

1. **Multimodal Interactions**:
   - Text-to-speech for AI responses (ElevenLabs integration)
   - Image uploads with AI vision analysis
   - Voice message uploads with transcription
   - Rich media sharing (YouTube links, etc.)

2. **Advanced Features**:
   - Message regeneration tracking
   - Model fallback handling
   - High-precision timestamps (microsecond resolution)
   - Maintains full conversation context

3. **Content Types**:
   - Long-form responses (1000+ characters)
   - Markdown formatting
   - Discord emote integration
   - Explicit/NSFW content handling
   - Philosophical and personal discussions

4. **Storage Patterns**:
   - Messages stored chronologically
   - User/AI messages in same structure
   - Media stored separately with URL references
   - No apparent message editing capability

#### Relationship to Long-Term Memory
While primarily used for active conversation context (STM), this endpoint can retrieve complete conversation history using `before_ts` pagination. This serves dual purposes:

1. **Short-Term Memory (STM)**: Without `before_ts`, returns recent messages for AI context
2. **Full History Access**: With `before_ts`, enables browsing/exporting entire conversation history

The retrieved messages are separate from:
- **Long-term memories** (stored in `{name}_memories.json` files) - AI-generated summaries
- **Knowledge base** (stored in `{name}_knowledge.json` files) - Factual information
- **User personalization** (stored in `{name}_user_personalization.json` files) - Preferences

#### Example: Complete History Retrieval
```javascript
// Paginate through entire history
let allMessages = [];
let beforeTs = null;

while (true) {
  const url = beforeTs 
    ? `/api/shapes/${shapeId}/chat/history?limit=50&before_ts=${beforeTs}`
    : `/api/shapes/${shapeId}/chat/history?limit=50`;
    
  const batch = await fetch(url);
  if (batch.length === 0) break;
  
  allMessages.push(...batch);
  beforeTs = Math.min(...batch.map(m => m.ts));
}
```

### Long-Term Memory Structure
From backup files (`{name}_memories.json`):

```json
{
  "id": "conversation-id/message-id",
  "shape_id": "personality-uuid",
  "result": "AI-generated summary of the conversation",
  "summary_type": "automatic",
  "group": false,
  "created_at": 1721971316.572563,
  "metadata": {
    "discord_channel_id": "",
    "discord_guild_id": "",
    "group": false,
    "senders": ["user-uuid"],
    "shape_id": "personality-uuid",
    "msg_ids": ["message-id-1", "message-id-2", ...]
  }
}
```

This shows shapes.inc automatically summarizes conversations from STM into long-term memories for future retrieval.

### Shape Data Structure (Private API)
The private API returns everything from public API plus:

```json
{
  // All public fields plus:
  
  // AI Configuration
  "user_prompt": "The actual personality prompt used by AI",
  "jailbreak": "Text generation unrestriction prompt",
  "image_jailbreak": "Image generation unrestriction prompt",
  "engine_model": "Specific AI model configuration",
  "engine_temperature": 1.0,
  
  // Voice Configuration
  "voice_model": "eleven_multilingual_v2",
  "voice_id": "ElevenLabs voice identifier",
  "voice_file": "https://files.shapes.inc/voice_sample.mp3",
  "voice_frequency": 1,
  "voice_stability": 0.53,
  "voice_similarity": 0.74,
  "voice_style": 0.16,
  "voice_transcription_enabled": true,
  "voice_engine_instructions": "",
  "voice_history_instructions": "",
  
  // Image Generation
  "image_size": "square_hd",
  "force_image_size": false,
  
  // User Management
  "user_id": ["owner-uuid"],
  "blocked_user_id": [],
  "credits_used": 0,
  "credits_available": 0,
  
  // Moderation
  "is_high_risk": false,
  "is_sensitive": false,
  "is_sensitive_image": false,
  "self_identified_sensitive": true,
  "auto_moderation_results": {
    "id": "modr-xxxx",
    "model": "omni-moderation-latest",
    "results": [/* detailed breakdowns */]
  },
  
  // Other
  "birthday": null,
  "deleted": false,
  "timezone": "America/New_York",
  "language_preset": null,
  "x_auth_url": null
}
```

### Related Data Files
Each personality in the private API also has associated data files:
- `{username}_knowledge.json` - Knowledge base entries
- `{username}_memories.json` - Conversation history
- `{username}_user_personalization.json` - Per-user customizations

## Data Availability Comparison

| Data Type | Public API | Private API | Required For |
|-----------|------------|-------------|--------------|
| Basic Profile | ✅ | ✅ | Display |
| Description/Tags | ✅ | ✅ | Search/Discovery |
| Statistics | ✅ | ✅ | Analytics |
| Error Messages | ✅ | ✅ | User Experience |
| AI Prompts | ❌ | ✅ | **Text Generation** |
| Voice Config | ❌ | ✅ | **Voice Synthesis** |
| Image Config | ❌ | ✅ | **Image Generation** |
| Knowledge Base | ❌ | ✅ | **RAG/Context** |
| Memories | ❌ | ✅ | **Conversation History** |
| User Personalization | ❌ | ✅ | **Per-user Experience** |

## Security Considerations

### Session Cookie Risks
1. **Expiration**: Cookies expire, requiring manual refresh
2. **Security**: Sharing cookies exposes user accounts
3. **Revocation**: Shapes.inc can invalidate sessions anytime
4. **Detection**: Automated use may trigger security measures

### Data Privacy
- User data includes personal conversation histories
- Knowledge bases may contain sensitive information
- Proper data handling and user consent required

## Migration Necessity

The public API's limitations make it impossible to:
1. Generate AI responses (no prompts)
2. Use voice features (no voice IDs)
3. Generate images (no image configuration)
4. Maintain conversation context (no memory access)
5. Personalize interactions (no user data)

This necessitates migration to a local implementation using backed-up data from the private API, obtained through the one-time cookie export process.