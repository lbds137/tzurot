# Atomic Message Storage - Implementation Plan

**Branch**: `refactor/atomic-message-storage`
**Created**: 2025-11-07
**Status**: Planning

---

## Problem Statement

Current message storage has critical race conditions:

1. **User messages** saved incomplete, then enriched 5-60s later (data loss on crash)
2. **Assistant messages** created before Discord send (orphaned records on failure)

---

## Constraints Discovered

### Constraint #1: Chronological Ordering Requirement

**Location**: `MessageHandler.handlePersonalityMessage()` line 420-422

```typescript
// Save user message to conversation history BEFORE calling AI
// This ensures proper chronological ordering (user message timestamp < assistant response timestamp)
```

**Why it matters**:

- AI worker creates assistant message during `storeInteraction()` (line 816)
- Uses PostgreSQL `createdAt` default (current timestamp)
- If user message saved AFTER AI completes, assistant timestamp < user timestamp
- Breaks chronological conversation history

**Implication**: Cannot simply delay user message save until after AI processing

---

### Constraint #2: Attachment Processing Location

**Current flow**:

1. Bot-client sends attachments to AI worker as metadata
2. AI worker processes attachments (vision/transcription) for prompt assembly
3. AI worker returns descriptions for user message enrichment
4. Bot-client updates user message with descriptions

**Why it matters**:

- Attachment processing (5-15s per image) happens during AI generation
- Processing is expensive (OpenAI vision API, Whisper API)
- Cannot duplicate processing (wasteful, expensive)
- AI MUST see attachment content before generating response

**Implication**: Cannot process attachments before calling AI worker without duplicating work

---

## Solution Approaches (Analysis)

### Approach A: Timestamp-Controlled User Message

**Idea**: Save user message with explicit timestamp before AI processing

**Steps**:

1. Capture timestamp: `const userMessageTime = new Date()`
2. Call AI worker (processes attachments, creates assistant message)
3. Get descriptions back
4. Save/update user message with enriched content + explicit timestamp

**Pros**:

- Maintains chronological ordering
- Single attachment processing

**Cons**:

- Requires schema change (createdAt override)
- Still has race condition window
- Prisma doesn't easily support timestamp override on create

**Verdict**: ❌ Not feasible without major Prisma changes

---

### Approach B: Inline Attachment Processing

**Idea**: Process attachments in bot-client before calling AI worker

**Steps**:

1. Bot-client processes attachments (vision/transcription)
2. Build complete user message content
3. Save user message (complete, atomic)
4. Call AI worker with pre-processed descriptions
5. AI worker uses descriptions for prompt (doesn't re-process)

**Pros**:

- Atomic user message storage
- No race condition for user message

**Cons**:

- Moves expensive processing to bot-client (architecture smell)
- AI worker needs refactoring to accept pre-processed descriptions
- Bot-client becomes more complex
- Potential timeout issues in bot-client

**Verdict**: ❌ Wrong architectural layer for processing

---

### Approach C: Two-Phase AI Worker Call

**Idea**: Separate attachment processing from response generation

**Steps**:

1. Bot-client calls AI worker: "process attachments only"
2. AI worker processes attachments, returns descriptions (no LLM call)
3. Bot-client saves user message with complete content
4. Bot-client calls AI worker: "generate response" (with pre-processed descriptions)
5. AI worker generates response using provided descriptions

**Pros**:

- Atomic user message storage
- Processing stays in AI worker (correct layer)
- Maintains chronological ordering

**Cons**:

- Two API calls instead of one
- More complex AI worker interface
- Increased latency (network round-trips)
- Attachment processing separated from response generation (could lead to inconsistency)

**Verdict**: ⚠️ Viable but adds complexity and latency

---

### Approach D: Deferred Assistant Message + Timestamp Injection

**Idea**: AI worker returns response WITHOUT creating DB record, bot-client creates both messages

**Steps**:

1. Save user message (incomplete) with current timestamp
2. Call AI worker
3. AI worker processes attachments, generates response, returns data (NO DB save)
4. Bot-client updates user message with descriptions
5. Bot-client sends response to Discord
6. Bot-client creates assistant message with timestamp = userMessageTime + 1ms

**Pros**:

- Fixes Critical #2 (no orphaned assistant messages)
- Maintains chronological ordering via explicit timestamp
- Assistant message created with Discord IDs from the start

**Cons**:

- Still has race condition for user message enrichment
- Requires timestamp parameter for assistant message creation
- Doesn't fully fix Critical #1

**Verdict**: ⚠️ Partial solution (fixes #2 but not #1)

---

### Approach E: Accept The Race Condition (Document It)

**Idea**: Keep current architecture, add safeguards and documentation

**Steps**:

1. Document the race condition window in code
2. Add database constraint to prevent orphaned records
3. Add retry logic for enrichment failures
4. Add monitoring/alerts for incomplete messages
5. Accept that user messages might be incomplete on crash

**Pros**:

- Minimal code changes
- Works with existing architecture
- Fast to implement

**Cons**:

- Doesn't fix the fundamental issue
- Data loss still possible
- Technical debt remains

**Verdict**: ❌ Avoiding the problem, not solving it

---

## Recommended Solution: Approach D (Deferred Assistant Message)

### Why This Approach

1. **Fixes Critical #2 completely** - No orphaned assistant messages
2. **Maintains chronological ordering** - Explicit timestamp control
3. **Minimal architectural changes** - AI worker returns data instead of saving
4. **Sets foundation for fixing #1** - Can add two-phase processing later

### Implementation Plan

#### Phase 1: Defer Assistant Message Creation (This PR)

**Changes to AI worker**:

- `ConversationalRAGService.generateResponse()`:
  - Remove `storeInteraction()` call
  - Return `RAGResponse` with all data (content, descriptions, metadata)
  - Do NOT create conversation_history record
  - Do NOT create LTM record

**Changes to bot-client**:

- `MessageHandler.handlePersonalityMessage()`:
  - After Discord send succeeds:
    - Create assistant message with Discord chunk IDs
    - Create LTM memory with complete metadata
  - Use timestamp injection: `userMessageTime + 1ms`

**Schema changes**:

- `ConversationHistoryService.addMessage()`:
  - Add optional `timestamp?: Date` parameter
  - Use provided timestamp if given, otherwise default

**Benefits**:

- ✅ Fixes Critical #2 (orphaned assistant messages)
- ✅ Maintains chronological ordering
- ✅ Assistant messages have Discord IDs from the start
- ✅ LTM gets complete metadata

**Trade-offs**:

- ⚠️ User message enrichment still has race condition (will fix in Phase 2)

---

#### Phase 2: Two-Phase Processing (Future PR)

**Add to AI worker**:

- New endpoint: `processAttachments()`
  - Takes attachments/references
  - Returns descriptions only
  - No LLM call, no DB save

**Changes to bot-client**:

- Call `processAttachments()` first
- Save user message with complete content
- Call `generate()` with pre-processed descriptions

**Benefits**:

- ✅ Fixes Critical #1 (atomic user message)
- ✅ No data loss on crash

**Trade-offs**:

- ⚠️ Two API calls (adds latency)
- ⚠️ More complex interface

---

## Implementation Checklist (Phase 1)

### Code Changes

- [ ] **ConversationalRAGService.ts**:
  - [ ] Remove `storeInteraction()` call from `generateResponse()`
  - [ ] Return complete `RAGResponse` with metadata
  - [ ] Update return type if needed
  - [ ] Add comment explaining deferred storage

- [ ] **ConversationHistoryService.ts**:
  - [ ] Add `timestamp?: Date` parameter to `addMessage()`
  - [ ] Use provided timestamp or default to now()
  - [ ] Add comment explaining timestamp injection use case

- [ ] **MessageHandler.ts**:
  - [ ] Capture user message timestamp before AI call
  - [ ] After Discord send: create assistant message with timestamp
  - [ ] After Discord send: create LTM memory
  - [ ] Remove `updateLastAssistantMessageId()` call (no longer needed)
  - [ ] Add comments explaining PluralKit delay
  - [ ] Add comments explaining AI attachment requirement

### Tests

- [ ] **ConversationalRAGService.test.ts**:
  - [ ] Verify `generateResponse()` doesn't create DB records
  - [ ] Verify complete RAGResponse returned

- [ ] **MessageHandler.test.ts**:
  - [ ] Verify assistant message created after Discord send
  - [ ] Verify assistant message includes Discord chunk IDs
  - [ ] Verify chronological ordering (user < assistant timestamps)
  - [ ] Verify Discord send failure doesn't create assistant message

### Verification

- [ ] All existing tests pass
- [ ] Manual test: voice message end-to-end
- [ ] Manual test: multi-image message end-to-end
- [ ] Manual test: chunked response end-to-end
- [ ] Manual test: crash simulation (kill during processing)

---

## Rollout Plan

1. **Merge to develop** after all tests pass
2. **Deploy to Railway development** environment
3. **Monitor for 24-48 hours**:
   - Check for orphaned messages
   - Check chronological ordering
   - Check deduplication works
4. **Release PR to main** if stable

---

## Rollback Plan

If issues found:

1. Revert PR
2. Restore previous behavior
3. Investigate failures
4. Re-implement with fixes

---

## Future Work (Phase 2)

After Phase 1 is stable and deployed:

1. Design two-phase processing API
2. Implement `processAttachments()` endpoint
3. Refactor bot-client to call sequentially
4. Add tests
5. Deploy and monitor

---

## Open Questions

1. Should we add a DB constraint to detect orphaned messages?
2. Should we add monitoring/alerts for incomplete user messages?
3. What's the best way to handle LTM storage failures after this refactor?

---

**Status**: Ready for implementation (Phase 1 only)
**Next Step**: Begin code changes following checklist above
