# V2 Patterns Reference

> **Purpose**: Reference for v2 patterns worth porting to v3. Not code to copy directly, but approaches to understand.

**Last Updated**: 2025-12-11

---

## PluralKit Integration

**Location**: `tzurot-legacy/src/utils/pluralkitMessageStore.js`

**What it does**:
- Tracks user messages before PluralKit processes them
- When message is deleted (PluralKit auto-deletes originals), stores content
- When PluralKit webhook arrives, matches by content to identify original user

**Key pattern**:
```
User sends message → Store message data
Message deleted → Move to "deleted" storage
PluralKit webhook arrives → Find matching deleted message by content
                          → Return original user ID
```

**v3 considerations**:
- Content matching is fuzzy (handles proxy tag stripping)
- Needs 50%+ content match ratio to prevent false positives
- 5-second expiration (PluralKit processes in 1-2 seconds)
- Could use conversation history table instead of content matching

---

## Message Deduplication

**Location**: `tzurot-legacy/src/messageTracker.js`

**What it does**:
- Prevents duplicate message processing
- Prevents duplicate reply/send operations
- Auto-cleanup after 10 minutes

**Key pattern**:
```javascript
track(messageId, type) → returns false if already tracked
trackOperation(channelId, operationType, optionsSignature) → prevents duplicate operations within 5s
```

**v3 status**: Partially implemented in bot-client via in-memory tracking. Could be enhanced with Redis for horizontal scaling.

---

## Rate Limiting

**Location**: `tzurot-legacy/src/utils/rateLimiter.js`

**What it does**:
- Request queue with configurable spacing (default 6s between requests)
- Exponential backoff on 429 errors
- Global cooldown after consecutive rate limits
- Per-request context tracking

**Key pattern**:
```javascript
// Configurable options
minRequestSpacing: 6000      // Time between requests
maxConcurrent: 1             // Concurrent request limit
maxConsecutiveRateLimits: 3  // Before global cooldown
cooldownPeriod: 60000        // Global cooldown duration
maxRetries: 5                // Retry limit per request

// Usage
await rateLimiter.enqueue(async () => {
  return await externalApiCall();
});

// On 429 error
await rateLimiter.handleRateLimit(identifier, retryAfterSeconds, retryCount);
```

**v3 status**: Not implemented. Should be added for external API calls (OpenRouter, Discord API).

---

## AI Request Deduplication

**Location**: `tzurot-legacy/src/domain/ai/AIRequestDeduplicator.js`

**What it does**:
- Prevents identical AI requests from being sent concurrently
- SHA-256 signature based on: personality, content, userAuth, conversationId
- Error blackout periods (1 minute default) after failures
- Returns existing promise if duplicate request detected

**Key pattern**:
```javascript
// Check for duplicate
const existingPromise = await deduplicator.checkDuplicate(personality, content, context);
if (existingPromise) return existingPromise;

// Register new request
const promise = makeAIRequest();
deduplicator.registerPending(personality, content, context, promise);
```

**v3 status**: Not implemented. Should be added to ai-worker for expensive AI calls.

---

## DM Personality Chat

**Location**: `tzurot-legacy/src/handlers/dmHandler.js`

**What it does**:
- Handles personality conversations in DMs (no webhooks available)
- Parses `**PersonalityName:** ` prefix from bot messages to identify personality
- Multi-chunk reply detection (when AI response spans multiple messages)
- Falls back to regular bot messages instead of webhooks

**Key pattern**:
```javascript
// Parse personality from bot message format
const dmFormatMatch = content.match(/^\*\*([^:]+):\*\* /);
if (dmFormatMatch) {
  const personalityName = dmFormatMatch[1];
}

// Multi-chunk detection: if user replies to second chunk, find first chunk
// by looking for messages from bot within short time window
```

**v3 improvement**: Use conversation history table for personality matching instead of name-based (multiple personalities can have same name).

---

## NSFW Verification

**Location**: `tzurot-legacy/src/handlers/dmHandler.js` (lines 20-50)

**What it does**:
- One-time verification per user before NSFW content
- Auto-verifies if user uses bot in NSFW-marked Discord channel
- Persistent storage of verified user IDs

**Key pattern**:
```javascript
// Check if user is verified
const isVerified = await authService.isNsfwVerified(userId);
if (!isVerified && personality.isNsfw) {
  return "Please verify your age first...";
}

// Auto-verify in NSFW channels
if (channel.nsfw) {
  await authService.setNsfwVerified(userId);
}
```

**v3 status**: Schema has `nsfwVerified` field on User model. Not implemented in bot-client.

---

## Auto-Response System

**Location**: `tzurot-legacy/src/application/commands/conversation/ActivateCommand.js`

**What it does**:
- `/activate <personality>` - Enable personality auto-response in channel
- `/deactivate` - Disable auto-response
- Personality responds to ALL messages in activated channel
- Requires NSFW channel + ManageMessages permission

**Key pattern**:
```javascript
// Activate check
if (!channel.nsfw) {
  return "Auto-response only works in NSFW channels";
}
if (!hasPermission(ManageMessages)) {
  return "Need ManageMessages permission";
}

// Store activation
conversationManager.setActivated(channelId, personalityId);

// In message handler
if (conversationManager.isActivated(channelId)) {
  const personality = conversationManager.getActivatedPersonality(channelId);
  await respondAsPersonality(message, personality);
}
```

**v3 status**: Not implemented. Database schema may need `ActivatedChannel` table.

---

## Backup with Session Cookies

**Location**: `tzurot-legacy/src/application/commands/utility/BackupCommand.js`

**What it does**:
- Exports user data (personalities, settings)
- Uses session cookies for authenticated API calls
- Creates ZIP archive with JSON data

**Note**: This was specific to shapes.inc integration. v3 uses PostgreSQL, so backup is different (database export or API-based).

---

## Key Takeaways for v3

1. **Deduplication is multi-layered**: Message tracking, operation tracking, AI request deduplication
2. **Rate limiting needs exponential backoff**: Not just delays, but progressive backoff with cooldowns
3. **DM chat needs conversation history**: Don't rely on name matching alone
4. **PluralKit integration is content-based**: Match by message content, not IDs
5. **NSFW verification is per-user**: Not per-channel, stored persistently
6. **Auto-response requires permissions**: NSFW channel + ManageMessages
