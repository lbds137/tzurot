# Chat History Backup Guide

## Overview

With the discovery of the `before_ts` parameter in the external service API, we can now backup complete conversation histories, not just the recent context window. **Chat history is now automatically included in all backup operations** - no additional configuration needed!

## How It Works

The chat history endpoint supports timestamp-based pagination:

1. **Initial Request**: `/api/{jargon}/{id}/chat/history?limit=50` returns the most recent messages
2. **Pagination**: Find the earliest timestamp and request `/api/{jargon}/{id}/chat/history?limit=50&before_ts={timestamp}`
3. **Repeat**: Continue until no more messages are returned

## Seamless Integration

### 🎉 No Changes Required!

Chat history backup is now seamlessly integrated into all existing backup methods. Users don't need to:
- Set additional flags
- Provide separate cookies
- Use different commands

Just use the backup commands as you always have, and chat history will be included automatically!

### Method 1: Discord Command

```bash
# Set your session cookie (same as before)
!tz backup --set-cookie <appSession-value>

# Backup single personality (now includes chat history automatically!)
!tz backup <personality-name>

# Backup all owner personalities (chat history included)
!tz backup --all
```

### Method 2: Standalone Backup Script

```bash
# Same command as before - chat history now included automatically
SERVICE_COOKIE="your-cookie-value" \
SERVICE_WEBSITE="https://service.example.com" \
PERSONALITY_JARGON_TERM="personalities" \
node scripts/backup-personalities-data.js personality1 personality2
```

### Implementation Details

The chat history backup is now fully integrated into the existing backup infrastructure:
- Uses the same appSession cookie as other API calls
- Automatically fetches personality IDs from the public API
- Stores messages chronologically (oldest first) for efficient incremental updates
- Syncs only new messages on subsequent backups (like memories)

## Getting Required Cookies

### Standard Session Cookie (appSession)
Required for basic API access:

1. Log into the service website in your browser
2. Open Developer Tools (F12)
3. Go to Application/Storage → Cookies
4. Find the `appSession` cookie
5. Copy its value (the long string)

### Chat-Specific Cookies (connect.sid, _csrf)
Required for chat history access:

1. Open the service website and navigate to any personality chat
2. Open Developer Tools → Network tab
3. Send a message in the chat
4. Find the chat/history request in the Network tab
5. Look at Request Headers → Cookie
6. Extract the values for `connect.sid` and `_csrf`

**Important**: These cookies expire quickly (usually within hours), so you may need to refresh them frequently.

### Integration with Personality Backup

The script can be integrated with the existing personality backup to create comprehensive archives:

```javascript
const { backupChatHistory } = require('./backup-chat-history');

async function comprehensiveBackup(personality, cookies) {
  // 1. Backup personality data (existing)
  const personalityData = await backupPersonality(personality);
  
  // 2. Backup full chat history (new)
  const { messages, outputPath } = await backupChatHistory(
    personality.id,
    personality.name,
    cookies
  );
  
  // 3. Extract and save memories/knowledge if needed
  const memories = extractMemories(messages);
  const knowledge = extractKnowledge(messages);
  
  return {
    personality: personalityData,
    chatHistory: outputPath,
    statistics: {
      messageCount: messages.length,
      dateRange: getDateRange(messages)
    }
  };
}
```

## Output Format

The backup creates a JSON file with the following structure:

```json
{
  "shape_id": "personality-uuid",
  "shape_name": "personality-name",
  "message_count": 1234,
  "date_range": {
    "earliest": "2023-01-01T00:00:00.000Z",
    "latest": "2024-12-13T00:00:00.000Z"
  },
  "export_date": "2024-12-13T12:00:00.000Z",
  "messages": [
    {
      "id": "message-id",
      "message": "User message text",
      "reply": "AI response text",
      "ts": 1234567890.123,
      "voice_reply_url": "...",
      "attachment_url": "...",
      "attachment_type": "...",
      "regenerated_replies": [],
      "fallback_model_used": false
    }
  ]
}
```

## Considerations

### Rate Limiting
- The script includes a 1-second delay between requests
- For extensive histories, backups may take several minutes
- Consider implementing resume capability for interrupted backups

### Storage Requirements
- Chat histories can be large (potentially GB for active personalities)
- Each message averages 1-2KB with metadata
- 10,000 messages ≈ 10-20MB of JSON

### Privacy & Security
- Chat histories contain personal conversations
- Store backups securely
- Consider encryption for sensitive content
- Never share session cookies

### Performance Tips
1. **Batch Processing**: Process messages in chunks to avoid memory issues
2. **Compression**: Consider gzipping large backups
3. **Incremental Backups**: Store last backup timestamp to fetch only new messages
4. **Parallel Downloads**: Could fetch multiple personalities concurrently (with care for rate limits)

## Advanced Usage

### Incremental Backups

```javascript
async function incrementalBackup(shapeId, shapeName, cookies, lastBackupTs) {
  // Only fetch messages newer than last backup
  const newMessages = [];
  let beforeTs = null;
  
  while (true) {
    const batch = await fetchBatch(shapeId, cookies, beforeTs);
    
    // Filter messages newer than last backup
    const relevant = batch.filter(msg => msg.ts > lastBackupTs);
    if (relevant.length === 0) break;
    
    newMessages.push(...relevant);
    beforeTs = Math.min(...batch.map(m => m.ts));
  }
  
  return newMessages;
}
```

### Memory Extraction

```javascript
function extractSignificantExchanges(messages, threshold = 5) {
  const conversations = [];
  let current = [];
  
  for (const msg of messages) {
    current.push(msg);
    
    // Detect conversation boundaries (e.g., time gaps)
    if (isConversationEnd(msg, messages)) {
      if (current.length >= threshold) {
        conversations.push({
          messages: current,
          summary: generateSummary(current),
          timestamp: current[0].ts
        });
      }
      current = [];
    }
  }
  
  return conversations;
}
```

## Integration with Migration

This backup capability is crucial for migration because:

1. **Complete History**: Preserves entire conversation context
2. **Memory Mining**: Can extract patterns and important exchanges
3. **User Personalization**: Analyze interactions to understand preferences
4. **Training Data**: Could fine-tune local models on conversation style

The backed-up chat history can be imported into the new system's message archive, ensuring continuity of experience post-migration.