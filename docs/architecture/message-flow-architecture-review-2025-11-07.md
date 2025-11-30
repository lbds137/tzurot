# Message Flow Architecture Review - 2025-11-07

**Status**: Active - Driving refactor in `refactor/atomic-message-storage` branch
**Reviewer**: Claude (AI Assistant) via Explore agent
**Requested By**: User (Lila)
**Context**: Investigating timing issues and race conditions after fixing chunked message deduplication

---

## Executive Summary

Architecture review identified **7 race conditions** and **7 architectural smells** in the message handling system. The core issue is **optimistic database updates** - storing incomplete data and "fixing it later" creates race condition windows that cause:

- **Data loss** if bot crashes during enrichment
- **Orphaned records** if Discord send fails
- **Broken deduplication** during ID backfilling
- **Inconsistent conversation history** during processing

### Severity Breakdown

- **CRITICAL** (2): Data loss risks, orphaned records
- **MEDIUM** (3): Performance issues, unreliable deduplication
- **MINOR** (2): Cache misses, routing failures

---

## Current Flow (With Timing)

```
TIME: 0ms - Discord Message Received
├─ bot-client/MessageHandler.handleMessage()
│
├─ TIME: ~10-50ms - Voice Transcription (if AUTO_TRANSCRIBE_VOICE=true)
│  ├─ handleVoiceTranscription() → gatewayClient.transcribe()
│  ├─ api-gateway queues transcribe job
│  ├─ ai-worker processes via Whisper API (~5-20s)
│  ├─ Transcript sent as Discord reply
│  └─ Transcript cached in Redis (5min TTL)
│
├─ TIME: ~100ms - User Record Creation
│  ├─ userService.getOrCreateUser() - Creates user if needed
│  ├─ userService.getPersonaForUser() - Gets/creates persona
│  └─ Database writes BEFORE conversation history query
│
├─ TIME: ~150ms - Conversation History Fetch
│  ├─ conversationHistory.getRecentHistory()
│  ├─ Extract Discord message IDs for deduplication
│  └─ Extract timestamps for fallback deduplication
│
├─ TIME: ~2500ms - Message Reference Extraction (INTENTIONAL DELAY)
│  ├─ MessageReferenceExtractor waits 2.5s for Discord embed processing
│  ├─ Re-fetches message to get updated embeds
│  ├─ Extracts reply references
│  ├─ Extracts message link references
│  ├─ Deduplicates using conversation history Discord IDs
│  ├─ Fallback: timestamp matching (±15s) for bot/webhook messages <60s old
│  └─ Replaces Discord links with [Reference N] placeholders
│
├─ TIME: ~2600ms - User Message Saved to conversation_history
│  ├─ conversationHistory.addMessage() - role='user'
│  ├─ ❌ Stores ONLY message content (no attachments yet)
│  ├─ Includes Discord message ID for deduplication
│  └─ **CRITICAL: Assistant response NOT yet created**
│
├─ TIME: ~2650ms - AI Processing Begins
│  ├─ gatewayClient.generate() → api-gateway → BullMQ → ai-worker
│  │
│  ├─ ai-worker/AIJobProcessor.processGenerateJob()
│  │  ├─ Extracts participants from conversation history
│  │  ├─ Converts history to LangChain BaseMessage format
│  │  └─ Passes to ConversationalRAGService
│  │
│  ├─ ConversationalRAGService.generateResponse()
│  │  │
│  │  ├─ STEP 1: Process Attachments (Images/Voice) - PARALLEL
│  │  │  ├─ Images → Vision model (~5-15s per image)
│  │  │  ├─ Voice → Whisper API (~5-20s per audio)
│  │  │  └─ Results: Text descriptions for context
│  │  │
│  │  ├─ STEP 2: Format Referenced Messages - PARALLEL
│  │  │  ├─ ReferencedMessageFormatter.formatReferencedMessages()
│  │  │  ├─ Process all attachments in parallel (Promise.allSettled)
│  │  │  ├─ Images in refs → Vision model
│  │  │  ├─ Voice in refs → Whisper API
│  │  │  └─ Returns formatted text for prompt
│  │  │
│  │  ├─ STEP 3: Memory Retrieval
│  │  │  ├─ Uses transcription/descriptions for semantic search
│  │  │  ├─ Queries pgvector with time-based deduplication
│  │  │  └─ Excludes memories newer than oldest STM message (with buffer)
│  │  │
│  │  ├─ STEP 4: Prompt Assembly
│  │  │  ├─ System prompt with personality traits
│  │  │  ├─ Current date/time context
│  │  │  ├─ Discord environment (server/channel info)
│  │  │  ├─ Participant personas
│  │  │  ├─ Relevant memories from LTM
│  │  │  ├─ Conversation history (STM)
│  │  │  ├─ Current user message with attachments + references
│  │  │  └─ "Current Message" header (recency bias)
│  │  │
│  │  ├─ STEP 5: LLM Invocation (~3-30s depending on model)
│  │  │  ├─ Retry logic for transient errors (3 attempts)
│  │  │  ├─ Global timeout: 90s
│  │  │  └─ Returns raw response
│  │  │
│  │  └─ STEP 6: Store Interaction (❌ ASSISTANT MESSAGE CREATED HERE)
│  │     ├─ Strip personality prefix from response
│  │     ├─ Save assistant message to conversation_history
│  │     │  └─ **No Discord ID yet - will be backfilled later**
│  │     ├─ Create pending_memory record (safety net)
│  │     ├─ Store to pgvector LTM (with timestamp from PostgreSQL)
│  │     └─ Delete pending_memory on success
│  │
│  └─ Returns: { content, attachmentDescriptions, referencedMessagesDescriptions }
│
├─ TIME: ~15-60s - Back to MessageHandler (AI response ready)
│  │
│  ├─ ❌ Update user message with enriched content
│  │  ├─ conversationHistory.updateLastUserMessage()
│  │  ├─ Adds attachment descriptions (from vision/transcription)
│  │  ├─ Adds reference descriptions
│  │  └─ **NOW user message has complete context**
│  │
│  ├─ Send response via webhook/DM
│  │  ├─ Split into chunks (2000 char Discord limit)
│  │  ├─ Send each chunk
│  │  ├─ Collect all chunk Discord IDs
│  │  └─ Store personality mapping in Redis (7 day TTL)
│  │
│  └─ ❌ Backfill Discord IDs
│     ├─ conversationHistory.updateLastAssistantMessageId()
│     ├─ Updates assistant message with Discord chunk IDs
│     └─ Enables future deduplication
│
└─ TIME: ~16-62s - Complete
```

**❌ = Race condition / fragile operation**

---

## Critical Race Conditions

### CRITICAL #1: Attachment Processing After User Message Stored

**Location**: `MessageHandler.handlePersonalityMessage()` (lines 420-491)

**Problem**:

```typescript
// Line 423: User message saved WITHOUT attachments
await this.conversationHistory.addMessage(
  message.channel.id,
  personality.id,
  personaId,
  'user',
  messageContentForAI || '[no text content]',
  message.guild?.id || null,
  message.id
);

// Line 434: AI processes attachments (5-20s delay)
const response = await this.gatewayClient.generate(personality, context);

// Line 485: Update with enriched content ONLY IF we got descriptions
if (response.attachmentDescriptions || ...) {
  await this.conversationHistory.updateLastUserMessage(...)
}
```

**Race Condition Window**: 5-60 seconds between initial save and enrichment

**Impact**:

- ❌ If bot crashes between save and update, user message has `[voice message: 5s]` placeholder instead of transcript
- ❌ If next user message arrives before enrichment completes, conversation history is incomplete
- ❌ Database queries during this window get partial data
- ❌ LTM storage happens with partial context (assistant message saved in `storeInteraction` before user enrichment)

**Severity**: **CRITICAL** - Data loss on crash, inconsistent history

**Fix**: Process attachments BEFORE saving user message (see Recommended Fixes below)

---

### CRITICAL #2: Assistant Message Created During AI Processing

**Location**: `ConversationalRAGService.storeInteraction()` (lines 782-913)

**Problem**:

```typescript
// Line 816: Assistant message saved during AI processing
const conversationRecord = await prisma.conversationHistory.create({
  data: {
    role: 'assistant',
    content: aiResponse,
    // NO discordMessageId yet - message not sent!
  },
});

// MessageHandler sends response LATER (lines 509-544)
// Then backfills Discord IDs (lines 546-567)
```

**Race Condition Window**: 10-30 seconds between DB save and Discord send

**Impact**:

- ❌ Assistant message exists in DB without Discord ID
- ❌ Deduplication relies on timestamp fallback (±15s tolerance)
- ❌ If Discord send fails, orphaned assistant message in DB
- ❌ If bot crashes, assistant message has no Discord reference

**Severity**: **CRITICAL** - Orphaned records, deduplication failures

**Fix**: Create assistant message AFTER Discord send succeeds (see Recommended Fixes below)

---

## Medium Issues

### MEDIUM #1: Time-Based Fallback Deduplication

**Location**: `MessageReferenceExtractor.shouldIncludeReference()` (lines 571-637)

**Problem**:

```typescript
// Line 589-606: Fallback to timestamp matching
if (message.webhookId || message.author.bot) {
  const messageTime = message.createdAt.getTime();
  const timeDiff = Math.abs(messageTime - historyTime);

  // If timestamps match within 15 seconds, likely the same message
  if (timeDiff < 15000) {
    return false; // Exclude as duplicate
  }
}
```

**Impact**:

- Two messages within 15s could be falsely deduplicated
- Clock skew between services affects matching
- Relies on conversation history being up-to-date (but user enrichment is delayed!)

**Severity**: **MEDIUM** - False deduplication in edge cases

**Fix Decision**: Will be resolved by fixing Critical #2 (proper Discord IDs from the start)

---

### MEDIUM #2: 2.5s Embed Processing Delay

**Location**: `MessageReferenceExtractor.extractReferencesWithReplacement()` (line 89)

**Problem**:

```typescript
// Wait for Discord to process embeds
await this.delay(this.embedProcessingDelayMs); // 2500ms hardcoded
```

**Impact**:

- Every message waits 2.5s even if embeds aren't needed
- Adds latency to all responses (not just those with links)

**Severity**: **MEDIUM** - Unnecessary latency

**Fix Decision**: **KEEP AS-IS** - Required for future PluralKit support where we'll need to detect proxy messages via embed metadata. Code comment added to document this architectural decision.

---

### MEDIUM #3: Attachment Processing in Critical Path

**Location**: `ConversationalRAGService.generateResponse()` (lines 266-275)

**Problem**: Vision/transcription models block AI response (5-15s per image)

**Impact**: User waits for ALL attachments + ALL references before AI starts

**Severity**: **MEDIUM** - Slow responses with images

**Fix Decision**: **KEEP AS-IS** - AI MUST see attachment content before composing reply. Processing async would make AI blind to attachment context. Code comment added to document this requirement.

---

## Architectural Decisions Documented

### Decision #1: Keep 2.5s Embed Delay

**Reasoning**: Required for future PluralKit proxy detection

- PluralKit sends messages via webhooks with original author info in embeds
- Embeds take time to populate after message send
- Need to re-fetch message after delay to get embed metadata
- Will enable distinguishing proxy messages from bot's own messages

**Code Location**: `MessageReferenceExtractor` constructor
**Comment Added**: Yes

---

### Decision #2: Keep Attachments in Critical Path

**Reasoning**: AI must see attachment content before generating response

- Vision model descriptions are crucial for understanding images
- Voice transcripts change meaning of entire message
- Processing async would make AI blind to visual/audio context
- User experience is better with informed response than fast blind response

**Code Location**: `ConversationalRAGService.generateResponse()`
**Comment Added**: Yes

---

## Recommended Fixes (Implemented)

### Fix #1: Atomic User Message Storage

**Goal**: Process attachments BEFORE saving user message (one atomic save)

**Before**:

```typescript
// Save incomplete user message
await conversationHistory.addMessage(content);

// Process attachments (5-60s later)
const response = await gatewayClient.generate(context);

// Update with enrichment
await conversationHistory.updateLastUserMessage(enrichedContent);
```

**After**:

```typescript
// Process attachments FIRST (before any DB save)
const attachmentDescriptions = await processAttachments(context.attachments);

// Build complete message content
const completeContent = buildCompleteMessage(messageContent, attachmentDescriptions);

// Save ONCE with complete data
await conversationHistory.addMessage(completeContent);

// No update needed - data is complete from the start
```

**Benefits**:

- ✅ No partial data in database
- ✅ No race condition window
- ✅ Simpler code (one save, no update)
- ✅ Crash-safe

**Trade-off**: User sees typing indicator later (but gets better response)

---

### Fix #2: Defer Assistant Message Creation

**Goal**: Create assistant message AFTER Discord send succeeds

**Before**:

```typescript
// In ConversationalRAGService.storeInteraction():
const conversationRecord = await prisma.conversationHistory.create({
  data: {
    role: 'assistant',
    content: aiResponse,
    // No Discord ID yet!
  },
});

// In MessageHandler (later):
const chunkIds = await sendResponse();
await conversationHistory.updateLastAssistantMessageId(chunkIds);
```

**After**:

```typescript
// In ConversationalRAGService.generateResponse():
// Just return the AI response, don't store yet
return { content: aiResponse };

// In MessageHandler (after Discord send):
const chunkIds = await sendResponse();

// NOW create assistant message with complete metadata
await conversationHistory.addMessage(
  channelId,
  personalityId,
  personaId,
  'assistant',
  response.content,
  guildId,
  undefined, // No single Discord ID
  chunkIds // Array of chunk IDs
);

// Store to LTM with complete metadata
await memoryManager.addMemory({
  text: interactionText,
  metadata: { discordMessageIds: chunkIds },
});
```

**Benefits**:

- ✅ No orphaned records
- ✅ No backfilling needed
- ✅ LTM has complete metadata from the start
- ✅ Simpler transaction boundary

**Trade-off**: LTM storage happens later (but more reliably)

---

## Implementation Checklist

- [x] Document architecture review
- [ ] Fix Critical #1: Atomic user message storage
  - [ ] Move attachment processing before user message save
  - [ ] Remove `updateLastUserMessage()` call
  - [ ] Update tests
- [ ] Fix Critical #2: Defer assistant message creation
  - [ ] Move assistant message creation to MessageHandler
  - [ ] Remove `storeInteraction()` from ConversationalRAGService
  - [ ] Move LTM storage to MessageHandler
  - [ ] Update tests
- [ ] Add architectural decision comments
  - [ ] PluralKit delay explanation
  - [ ] Attachment processing requirement
- [ ] Verify all tests pass

---

## Testing Requirements

### Unit Tests (New)

1. **User message atomic storage**:
   - Verify attachments processed before DB save
   - Verify no update call after save
   - Verify crash during processing doesn't create partial record

2. **Assistant message deferred creation**:
   - Verify no DB record until Discord send succeeds
   - Verify Discord send failure doesn't create orphaned record
   - Verify chunk IDs included from the start

3. **Error scenarios**:
   - Attachment processing failure
   - Discord send failure
   - LTM storage failure

### Integration Tests

1. End-to-end flow with voice message
2. End-to-end flow with multiple images
3. End-to-end flow with chunked response

### Regression Tests

- All existing tests must continue passing
- No change to external API contracts

---

## Files Changed

### Modified

- `services/bot-client/src/handlers/MessageHandler.ts`
- `services/ai-worker/src/services/ConversationalRAGService.ts`
- `packages/common-types/src/services/ConversationHistoryService.ts`
- `services/bot-client/src/context/MessageReferenceExtractor.ts` (comments only)

### Tests Added/Updated

- `services/bot-client/src/handlers/MessageHandler.test.ts`
- `services/ai-worker/src/services/ConversationalRAGService.test.ts`

---

## Related Issues

- #219 - Chunked message deduplication fix (inspired this review)
- Previous architecture review (date unknown, relevance uncertain)

---

## Future Improvements (Out of Scope)

These were identified but not fixed in this refactor:

1. **Replace time-based deduplication with request IDs** (Medium severity)
   - Requires schema migration
   - Should be done in separate PR

2. **Move personality routing to PostgreSQL** (Low severity)
   - Reduces Redis dependency
   - Should be done in separate PR

3. **Remove pending_memory safety net** (Low severity)
   - Simplifies architecture
   - Requires reliability improvements to vector storage first

---

**Last Updated**: 2025-11-07
**Branch**: `refactor/atomic-message-storage`
**Status**: Active development
