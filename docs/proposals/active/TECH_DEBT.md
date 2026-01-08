# Tech Debt Tracking

> Last updated: 2026-01-07

Technical debt items prioritized by ROI: bug prevention, maintainability, and scaling readiness.

---

## Priority 1: HIGH

### Timer Patterns Blocking Horizontal Scaling

**Problem**: `setInterval` patterns prevent running multiple instances (race conditions, double-processing).

| File                              | Pattern                  | Migration                |
| --------------------------------- | ------------------------ | ------------------------ |
| `LlmConfigResolver.ts`            | Cache cleanup interval   | BullMQ repeatable job    |
| `WebhookManager.ts`               | Webhook cleanup interval | BullMQ repeatable job    |
| `DatabaseNotificationListener.ts` | Reconnection timeout     | Redis-based coordination |

**Solution**: Create a "SystemQueue" in BullMQ with repeatable jobs. Use deterministic job IDs to prevent duplicate cron jobs on restart.

---

## Priority 2: MEDIUM

### Unbounded History Scanning in Duplicate Detection

**Problem**: `getRecentAssistantMessages()` scans the entire conversation history looking for 5 assistant messages. In edge cases (1000+ messages with no assistant messages in the last 500), this scans all messages.

**Current Location**: `services/ai-worker/src/utils/duplicateDetection.ts:547-553`

**Violation**: CLAUDE.md "Bounded Data Access" rule - "All queries returning arrays must be bounded."

**Solution**: Add maximum scan depth:
```typescript
const MAX_SCAN_DEPTH = 100; // Don't scan more than 100 messages back
for (let i = history.length - 1; i >= Math.max(0, history.length - MAX_SCAN_DEPTH) && messages.length < maxMessages; i--) {
```

**Source**: PR #453 code review (2026-01-07)

---

### Duplicate Detection Logging Verbosity

**Problem**: `isRecentDuplicate()` logs at INFO level for EVERY response, even when no duplicate is detected. This is intentional for diagnosing the January 2026 production incident, but creates log noise.

**Current Location**: `services/ai-worker/src/utils/duplicateDetection.ts:520-535`

**Solution**: After incident is diagnosed (target: Feb 2026):
- [ ] Downgrade PASSED logs from INFO to DEBUG
- [ ] Keep NEAR-MISS and DUPLICATE at INFO
- [ ] Consider adding feature flag for verbose mode

**Source**: PR #453 code review (2026-01-07)

---

### Basic Observability

**Problem**: No way to answer "Is the bot slow?" or "Why did it ignore that message?" without reading logs manually.

**Solution**: Structured logging with event types (not a full metrics stack yet).

Log these events:

- [ ] `event="rate_limit_hit"` - when rate limiter triggers
- [ ] `event="dedup_cache_hit"` - when deduplication prevents reprocessing
- [ ] `event="pipeline_step_failed"` - with step name and error
- [ ] `event="llm_request"` - with latency and token counts

**Note**: Defer Prometheus/Grafana until log volume makes grep impractical.

---

## Priority 3: LOW

### MessageContentBuilder Complexity Reduction

**Problem**: `buildMessageContent()` has complexity 37 (threshold: 15). It orchestrates multiple extraction paths (text, voice, forwarded messages, attachments) in a single function.

**Current Location**: `services/bot-client/src/services/MessageContentBuilder.ts`

**Solution**: Extract helper functions:

- [ ] `extractForwardedContent(message)` - forwarded message extraction (lines 210-254)
- [ ] `processVoiceAttachment(attachment, options)` - voice message handling
- [ ] `extractEmbedContent(embeds)` - embed image/content extraction

**Why low priority**: Function is well-tested with snapshot tests. Complexity is "inherent" due to IR pattern (single entry point orchestrating multiple paths). Refactoring is for readability, not bug prevention.

---

### Duplicate Detection Documentation

**Problem**: The cross-turn duplicate detection algorithm lacks inline performance documentation.

**Current Location**: `services/ai-worker/src/utils/duplicateDetection.ts`

**Items to document**:

- [ ] Why Dice coefficient vs Levenshtein distance (performance vs accuracy tradeoff)
- [ ] Time/space complexity: O(n) where n is string length
- [ ] Scaling consideration: If responses grow >10KB, consider MinHash/SimHash for O(1) checks

**Why low priority**: Algorithm works correctly and is performant at current scale. Documentation is for future maintainers.

---

### Parameterize MAX_RECENT_ASSISTANT_MESSAGES

**Problem**: The 5-message window for cross-turn duplicate detection is hardcoded.

**Current Location**: `services/ai-worker/src/utils/duplicateDetection.ts:67`

**Consideration**: Make configurable via personality or system config if:

- Different models exhibit different caching patterns
- Production data shows duplicates occurring further back than 5 turns

**Why low priority**: Current value (5) is based on production observations (January 2026). No evidence yet that it needs tuning per-model or per-personality.

---

### Use MessageRole Enum in Duplicate Detection

**Problem**: String literal `'assistant'` used for role comparison instead of `MessageRole.Assistant` enum.

**Current Location**: `services/ai-worker/src/utils/duplicateDetection.ts:552`

**Current Code**:
```typescript
if (history[i].role === 'assistant') {
```

**Solution**:
```typescript
import { MessageRole } from '@tzurot/common-types';
if (history[i].role === MessageRole.Assistant) {
```

**Why**: Prevents issues if enum value ever changes, makes code self-documenting.

**Source**: PR #453 code review (2026-01-07)

---

### DRY Role Distribution Calculation

**Problem**: Role distribution calculation is duplicated in two places.

**Locations**:
- `services/ai-worker/src/jobs/handlers/pipeline/steps/GenerationStep.ts:221-227`
- `services/ai-worker/src/utils/duplicateDetection.ts:569-586`

**Solution**: Extract shared helper to `duplicateDetection.ts`:
```typescript
export function getRoleDistribution(
  history: { role: string; content: string }[] | undefined
): Record<string, number>
```

**Source**: PR #453 code review (2026-01-07)

---

### Missing Test: Mixed UUID + discord: Format Participants

**Problem**: No test validates `getAllParticipantPersonas()` with participants that have mixed formats.

**Current Location**: `packages/common-types/src/services/resolvers/PersonaResolver.test.ts`

**Missing Test Case**:
```typescript
it('should handle mixed UUID and discord: format participants', async () => {
  const participants = [
    { personaId: 'valid-uuid-1234', ... },
    { personaId: 'discord:456789', ... }
  ];
  // Verify both formats are resolved correctly
});
```

**Source**: PR #453 code review (2026-01-07)

---

### Document discord:XXXX Format

**Problem**: The `discord:XXXX` format for participant IDs is used in multiple places but not documented in architecture docs.

**Locations using this format**:
- `PersonaResolver.resolveToUuid()`
- Extended context participant handling
- Conversation history sync

**Solution**: Add section to `docs/reference/architecture/` explaining:
- When discord: format is used (webhook messages before persona resolution)
- How it's resolved to UUIDs
- Why normalization at API boundary might be cleaner long-term

**Source**: PR #453 code review (2026-01-07)

---

### Large File Reduction

**Target**: No production files >400 lines

| File                       | Current | Target | Approach                                          |
| -------------------------- | ------- | ------ | ------------------------------------------------- |
| `PgvectorMemoryAdapter.ts` | 529     | <400   | Extract batch fetching logic                      |
| `DiscordChannelFetcher.ts` | ~550    | <400   | Extract message conversion/mapping logic          |
| `conversationUtils.ts`     | ~530    | <400   | Extract formatting helpers (XML, time gap, etc.)  |
| `MessageContextBuilder.ts` | ~520    | <400   | Extract attachment processing to separate helpers |

**Why low priority**: Large files slow AI assistants but don't directly cause bugs.

---

### Stop Sequence Participant Limit Documentation

**Problem**: Stop sequences are silently truncated when exceeding Gemini's 16-slot limit. In channels with >5 participants, some users aren't protected from identity bleeding.

**Current Location**: `services/ai-worker/src/services/RAGUtils.ts:126-128`

**Current behavior**:

- 11 slots reserved for XML tags, hallucination prevention, instruct format markers, personality name
- 5 slots available for participant names
- Participants beyond 5 are silently truncated (logged at info level, not visible to users)

**Potential solutions**:

- [ ] Prioritize recent/active participants over inactive ones
- [ ] Warn users when >5 participants are in a channel
- [ ] Document the 5-participant effective limit in user-facing docs
- [ ] Consider dynamic priority based on conversation recency

**Why low priority**: Edge case (most conversations have <5 participants). The truncation is logged, and identity bleeding is still caught by other stop sequences (User:, Human:, etc.).

---

### Voice Transcript Race Condition on Forwarded Messages

**Problem**: When a voice message is forwarded immediately after being sent, the transcript might not be ready yet.

**Current Location**: `services/bot-client/src/utils/MessageContentBuilder.ts:processVoiceAttachments()`

**Scenario**:

1. User A sends voice message → transcription job queued (~2-3 sec)
2. User B immediately forwards it (within seconds)
3. Bot processes forwarded message before transcription completes
4. Transcript lookup returns `undefined` → voice appears without transcript

**Potential Solutions**:

- [ ] Add short retry with timeout (e.g., 3 attempts, 1 sec apart)
- [ ] Return placeholder text: "[Transcript pending...]"
- [ ] Accept the edge case (rare in practice)

**Why low priority**: Forwarding usually happens after reading/listening, giving transcription time to complete. No user reports of this issue yet.

---

## Deferred (Not Worth It Yet)

These items are optimizations for problems we don't have at current scale:

| Item                              | Why Deferred                                                 |
| --------------------------------- | ------------------------------------------------------------ |
| Schema versioning for BullMQ jobs | No breaking changes yet, add when needed                     |
| Contract tests for HTTP API       | Single consumer (bot-client), integration tests catch breaks |
| Redis pipelining (2 calls → 1)    | Redis is fast enough at current traffic                      |
| Lua script pre-compilation        | Negligible perf gain                                         |
| BYOK `lastUsedAt` on actual usage | Nice-to-have, not breaking anything                          |
| Dependency Cruiser                | ESLint already catches most issues                           |

---

## Completed

### DRY Message Extraction ✅

**Problem**: Two parallel message processing paths (main vs extended context) kept diverging, causing bugs:

- Forwarded message attachments not extracted in main path
- Embed images missing in certain flows
- Voice transcript inconsistencies

**Solution**: Refactored `MessageContextBuilder.ts` to use `buildMessageContent()` (the single source of truth) instead of direct extraction functions. Both main and extended context paths now use the same extraction pipeline.

### Snapshot Tests for PromptBuilder ✅

16 snapshots in `PromptBuilder.test.ts` covering:

- Minimal system prompt (baseline)
- Multiple participants (8 participants - stop sequence scenario)
- Memories + guild environment
- Referenced messages
- Voice transcripts
- Image attachments
- Forwarded message context
- Complex combinations (attachments + refs + persona)
- Search query with pronoun resolution
- Search query with voice + refs + history

### Large File Refactoring

| File                            | Before | After | Method                                          |
| ------------------------------- | ------ | ----- | ----------------------------------------------- |
| `ConversationHistoryService.ts` | 704    | 455   | Extracted ConversationRetentionService          |
| `api-gateway/index.ts`          | 558    | 259   | Split into bootstrap/, middleware/, routes/     |
| `LLMGenerationHandler.ts`       | 617    | 131   | Pipeline pattern with 6 steps                   |
| `PgvectorMemoryAdapter.ts`      | 901    | 529   | Extracted memoryUtils.ts + PgvectorQueryBuilder |
| `PromptBuilder.ts`              | 627    | 496   | Extracted PersonalityFieldsFormatter            |

### Code Quality

- [x] ESLint `no-explicit-any` set to error
- [x] Test coverage for all entry points
- [x] Redis-backed rate limiter and deduplication
- [x] All TODOs resolved or tracked

### ResponseOrderingService Memory Safety ✅

Fixed in beta.38:

- **Stale job cleanup**: Added `registeredAt` timestamp and `cleanupStaleJobs()` method to remove orphaned pending jobs (15-minute threshold)
- **Input validation**: `handleResult()` now validates job was registered, delivers immediately if not (prevents silent buffering failures)

---

## ESLint Status

**Current**: 72 warnings (down from 110)

High-complexity functions (acceptable, inherent complexity):

- `MessageContentBuilder.ts:buildMessageContent()` - complexity 37
- `SettingsModalFactory.ts:parseDurationInput()` - complexity 26
