# Multi-Personality Support Improvement

**Status**: Deferred
**Priority**: Medium
**Complexity**: High
**Related**: PR #210 (Persona Name Enrichment), Message Reference System
**Last Updated**: 2025-11-03

---

## Overview

Currently, Tzurot v3 supports only **one personality per message**. Users must @mention a single personality (e.g., `@lilith`) to get a response. This document outlines a future improvement to support **multiple personality mentions** in a single message, enabling group conversations with multiple AI personalities.

---

## Current Limitations

### Single Personality Architecture

**Current Flow**:

1. User sends message: `@lilith what do you think?`
2. Bot detects single `@lilith` mention
3. Routes to Lilith personality
4. Generates response from Lilith's perspective
5. Stores in conversation history for Lilith

**Limitation**: Cannot do:

```
@lilith @sarcastic what do you both think about this?
```

### Why This Matters

**User Request Example** (from discussions):

- Multi-perspective responses (e.g., "Ask both the supportive and critical personalities")
- Group conversations between personalities (e.g., debate format)
- Cross-personality context sharing

---

## Desired Future State

### Multi-Personality Mentions

**Proposed Flow**:

1. User sends: `@lilith @sarcastic what do you think?`
2. Bot detects **multiple** personality mentions
3. Routes to **both** personalities
4. Generates response from **each** personality's perspective
5. Stores in conversation history for **both** personalities
6. Displays responses clearly attributed to each personality

**Example Response Format**:

```
[Lilith]: I think this is a fascinating question...

[Sarcastic]: Oh sure, another "fascinating question"...
```

---

## Connection to PR #210 (Reference Persona Enrichment)

### Code Review Insight

During PR #210 review, the reviewer suggested a test case:

> **Test**: "should handle same user with different personas in multiple references"
>
> - User A appears in references with persona X (from personality 1)
> - User A appears again with persona Y (from personality 2)
> - Verify both are enriched correctly with different persona names

**Current Status**: This test is **not needed** for current implementation because:

- Each message has exactly one `personalityId` context
- All references are enriched for that same personality
- User A can only appear with one persona per message

**Future Status**: This test **will be needed** when multi-personality support is added:

- A single message could have multiple `personalityId` contexts
- References would need enrichment for **each** personality context
- User A could appear with different personas in different response threads

### Reference Enrichment Impact

**Current Implementation** (PR #210):

```typescript
private async enrichReferencesWithPersonaNames(
  referencedMessages: ReferencedMessage[],
  conversationHistory: ConversationMessage[],
  personalityId: string // Single personality context
): Promise<void>
```

**Future Multi-Personality Implementation**:

```typescript
private async enrichReferencesWithPersonaNames(
  referencedMessages: ReferencedMessage[],
  conversationHistory: ConversationMessage[],
  personalityIds: string[] // Multiple personality contexts
): Promise<Map<string, ReferencedMessage[]>> // Enriched for each personality
```

**Challenge**: Each personality may see referenced messages with different persona names for the same user.

---

## Implementation Challenges

### 1. **Tagging Detection**

**Current**: `findPersonalityMention()` returns first match

```typescript
const personality = findPersonalityMention(message.content, personalities);
// Returns single LoadedPersonality or null
```

**Needed**: Parse multiple @mentions

```typescript
const personalities = findAllPersonalityMentions(message.content, personalities);
// Returns LoadedPersonality[]
```

**Complexity**: Low - straightforward parsing change

---

### 2. **Message Routing & Processing**

**Current**: Single message → Single personality → Single response

```typescript
await handlePersonalityMessage(message, personality, content);
```

**Needed**: Single message → Multiple personalities → Multiple responses

```typescript
const responses = await Promise.all(
  personalities.map(p => handlePersonalityMessage(message, p, content))
);
```

**Complexity**: Medium - need to handle concurrent processing

**Questions**:

- Process personalities sequentially or in parallel?
- How to handle if one personality fails?
- How to manage rate limits across multiple AI calls?

---

### 3. **Conversation History Isolation**

**Current**: Each personality has isolated conversation history per channel

```typescript
await conversationHistory.getRecentHistory(
  channelId,
  personalityId, // Single personality
  historyLimit
);
```

**Challenge**: With multi-personality, do personalities:

- **Option A**: See each other's responses? (true group conversation)
- **Option B**: Maintain separate histories? (parallel monologues)

**Recommendation**: Start with **Option A** (true group conversation) for better UX

**Complexity**: Medium - requires rethinking conversation history model

---

### 4. **Reference Persona Enrichment**

**Current**: References enriched once for single personality context

```typescript
await enrichReferencesWithPersonaNames(references, history, personalityId);
```

**Challenge**: Each personality may have different persona mappings for same user

**Example**:

- User "Alice" has:
  - Persona "Alice (Casual)" for Lilith personality
  - Persona "Alice (Professional)" for Sarcastic personality
- A referenced message from Alice should show different names to each personality

**Solution**:

```typescript
// Enrich separately for each personality
const enrichedReferences = new Map<string, ReferencedMessage[]>();
for (const personalityId of personalityIds) {
  const history = await conversationHistory.getRecentHistory(channelId, personalityId);
  const enriched = await enrichReferencesWithPersonaNames(references, history, personalityId);
  enrichedReferences.set(personalityId, enriched);
}
```

**Complexity**: High - requires parallel enrichment pipelines

---

### 5. **Response Display & Attribution**

**Current**: Single webhook per personality (avatar + name)

```typescript
await webhookManager.sendWebhookMessage(channel, personality, response);
```

**Challenge**: How to display multiple responses clearly?

**Options**:

**A. Sequential Webhooks** (Easiest):

```
[Webhook 1 - Lilith avatar]
I think this is fascinating...

[Webhook 2 - Sarcastic avatar]
Oh sure, "fascinating"...
```

**B. Combined Message with Sections**:

```
[Webhook - Combined]
━━━ Lilith ━━━
I think this is fascinating...

━━━ Sarcastic ━━━
Oh sure, "fascinating"...
```

**C. Discord Threads** (Most Organized):

- Main message: "Multiple personalities responding..."
- Thread: Each personality replies in thread
- Clearest attribution, best for long responses

**Recommendation**: Start with **Option A** (sequential webhooks) for simplicity

**Complexity**: Low to Medium depending on chosen approach

---

### 6. **Database Schema Changes**

**Current**: `ConversationHistory` table links to single `personalityId`

```prisma
model ConversationHistory {
  id            String   @id @default(uuid())
  channelId     String
  personalityId String   // Single personality
  personaId     String
  role          String
  content       String
  createdAt     DateTime @default(now())
}
```

**Challenge**: How to store multi-personality conversations?

**Option A**: Store each personality response separately (current schema works)

```typescript
// For message with @lilith @sarcastic
await conversationHistory.addMessage(channelId, 'lilith-id', ...);   // Lilith's response
await conversationHistory.addMessage(channelId, 'sarcastic-id', ...); // Sarcastic's response
```

**Option B**: Add `parentMessageId` to link responses from same source message

```prisma
model ConversationHistory {
  // ... existing fields
  parentMessageId String?  // Links responses from same user message
}
```

**Recommendation**: **Option A** (works with current schema) for initial implementation

**Complexity**: Low if using Option A, Medium if using Option B

---

### 7. **Cost & Performance**

**Current**: 1 message → 1 AI API call
**Multi-Personality**: 1 message → N AI API calls (N = number of @mentions)

**Implications**:

- **Cost**: Linear increase (2x personalities = 2x cost)
- **Latency**: Sequential processing slower than parallel
- **Rate Limits**: Need to manage concurrent API calls

**Mitigation**:

- Set maximum personalities per message (e.g., 3-4)
- Use parallel processing with proper error handling
- Consider queueing for better rate limit management

**Complexity**: Medium - need cost controls and performance monitoring

---

## Test Cases Needed

### Tagging Detection

- ✅ Single @mention (already works)
- ❌ Multiple @mentions
- ❌ Duplicate @mentions (e.g., `@lilith @lilith`)
- ❌ Invalid combinations (e.g., `@nonexistent @lilith`)
- ❌ Maximum mentions limit

### Message Processing

- ❌ All personalities respond successfully
- ❌ One personality fails, others succeed
- ❌ Concurrent processing doesn't cause race conditions
- ❌ Rate limiting across multiple personalities

### Conversation History

- ❌ Each personality sees all responses in channel
- ❌ History query returns correct multi-personality context
- ❌ Persona attribution is correct for each personality

### Reference Enrichment (The PR #210 Test Case)

- ❌ Same user with different personas in multiple personality contexts
- ❌ References enriched correctly for each personality
- ❌ Persona names vary appropriately based on personality context

### Response Display

- ❌ Multiple responses display clearly
- ❌ Attribution is obvious (which personality said what)
- ❌ Responses appear in correct order

### Edge Cases

- ❌ Empty message with just @mentions
- ❌ Long response from multiple personalities (chunking)
- ❌ User edits message to add/remove @mentions (how to handle?)

---

## Why Deferred

### Complexity Assessment

**Scope**: This is not a simple feature addition, it's a **architectural shift**

**Requires**:

1. Tagging detection changes (Low complexity)
2. Message routing overhaul (Medium complexity)
3. Conversation history model rethinking (High complexity)
4. Reference enrichment parallelization (High complexity)
5. Response display strategy (Medium complexity)
6. Performance & cost management (Medium complexity)

**Estimated Effort**: 2-3 weeks of focused development + testing

### Current Focus

**Higher Priority Items**:

1. ✅ Basic reference system (PR #210 - COMPLETED)
2. Message link following improvements (in progress)
3. BYOK (Bring Your Own Key) for public launch
4. Rate limiting and cost controls
5. Admin commands for bot management

**Reasoning**: Need to get core features stable and deployed before adding advanced multi-personality support.

---

## Prerequisites

Before implementing multi-personality support:

1. ✅ **Reference persona enrichment** (PR #210) - DONE
   - Foundation for per-personality context

2. ⏳ **Conversation history refactoring** (if needed)
   - Consider if current model supports group conversations

3. ⏳ **Rate limiting & cost controls**
   - Essential before multiplying API calls per message

4. ⏳ **Webhook management improvements**
   - May need better handling for concurrent webhook posts

5. ⏳ **Production deployment & monitoring**
   - Want stable baseline before adding complexity

---

## Future Implementation Plan

### Phase 1: Detection & Routing (Week 1)

- [ ] Update `findPersonalityMention()` to `findAllPersonalityMentions()`
- [ ] Add maximum mentions limit (3-4 personalities)
- [ ] Update message routing to handle multiple personalities
- [ ] Add basic tests for tagging detection

### Phase 2: Parallel Processing (Week 2)

- [ ] Implement concurrent personality processing
- [ ] Add error handling for partial failures
- [ ] Update conversation history queries for group context
- [ ] Add rate limiting across multiple AI calls

### Phase 3: Reference Enrichment (Week 2-3)

- [ ] Parallelize reference enrichment for multiple personalities
- [ ] Add the "multiple personas per user" test case from PR #210
- [ ] Verify persona attribution is correct per personality

### Phase 4: Response Display (Week 3)

- [ ] Implement chosen display strategy (likely sequential webhooks)
- [ ] Add clear attribution for each personality response
- [ ] Handle response ordering and timing

### Phase 5: Testing & Refinement (Week 3)

- [ ] Comprehensive integration testing
- [ ] Performance monitoring and optimization
- [ ] Cost analysis and limits
- [ ] User feedback and iteration

---

## Related Work

### PR #210: Reference Persona Enrichment

- **Status**: ✅ Merged to develop
- **Relevance**: Provides foundation for per-personality context in references
- **Future Work**: Will need parallel enrichment when multi-personality is added

### Message Link Following

- **Status**: In planning
- **Relevance**: References system must handle multi-personality context
- **Dependency**: This improvement builds on reference system

### BYOK (Bring Your Own Key)

- **Status**: Planned
- **Relevance**: Cost control critical before multiplying API calls
- **Priority**: Should implement before multi-personality to control costs

---

## Notes

- This document is a living design document and will be updated as implementation approaches
- The test case suggestion from PR #210 code review is captured here for future reference
- Multi-personality support is desirable but not critical for initial v3 launch
- Complexity and cost implications justify deferring until core features are stable

---

## Questions for Future Discussion

1. Should personalities see each other's responses in conversation history?
2. What's the maximum reasonable number of @mentions per message?
3. How to handle if some personalities respond and others fail?
4. Should there be personality interaction modes (debate, collaboration, etc.)?
5. How to handle voice transcription with multiple personalities?

---

**Document created**: 2025-11-03
**Related PR**: #210 (Reference Persona Enrichment)
**Next Review**: When BYOK and core features are stable
