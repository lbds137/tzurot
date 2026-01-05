# Tech Debt Tracking

> Last updated: 2026-01-05

Technical debt items prioritized by ROI: bug prevention, maintainability, and scaling readiness.

---

## Priority 1: CRITICAL

### DRY Message Extraction Refactor

**Plan**: `.claude/plans/rustling-churning-pike.md`

**Problem**: Two parallel message processing paths (main vs extended context) keep diverging, causing recurring bugs.

**Recent bugs from this pattern**:

- 2026-01-03: Forwarded message attachments not extracted in extended context
- 2026-01-03: Google API rejected >16 stop sequences
- Previous: Extended context missing embed images, voice transcript inconsistencies

**Solution**: Intermediate Representation (IR) pattern - single extraction pipeline:

```
RawDiscordMessage → NormalizedMessage → PromptContext
```

Both main and extended context flows consume `NormalizedMessage`.

**Prerequisite**: Snapshot tests for PromptBuilder (see Priority 2) must exist first as a safety net.

---

## Priority 2: HIGH

### ~~Snapshot Tests for PromptBuilder~~ ✅ COMPLETE

**Problem**: Prompt changes can silently break AI behavior. Manual testing is impossible at scale.

**Solution**: Snapshot the exact prompt string sent to the LLM (not the response).

**Completed scenarios** (16 snapshots in `PromptBuilder.test.ts`):

- [x] Minimal system prompt (baseline)
- [x] Multiple participants (8 participants - stop sequence scenario)
- [x] Memories + guild environment
- [x] Referenced messages
- [x] Voice transcripts
- [x] Image attachments
- [x] Forwarded message context
- [x] Complex combinations (attachments + refs + persona)
- [x] Search query with pronoun resolution
- [x] Search query with voice + refs + history

**Now safe to**: Proceed with DRY Message Extraction refactor.

---

### Timer Patterns Blocking Horizontal Scaling

**Problem**: `setInterval` patterns prevent running multiple instances (race conditions, double-processing).

| File                              | Pattern                  | Migration                |
| --------------------------------- | ------------------------ | ------------------------ |
| `LlmConfigResolver.ts`            | Cache cleanup interval   | BullMQ repeatable job    |
| `WebhookManager.ts`               | Webhook cleanup interval | BullMQ repeatable job    |
| `DatabaseNotificationListener.ts` | Reconnection timeout     | Redis-based coordination |

**Solution**: Create a "SystemQueue" in BullMQ with repeatable jobs. Use deterministic job IDs to prevent duplicate cron jobs on restart.

---

## Priority 3: MEDIUM

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

## Priority 4: LOW

### Large File Reduction

**Target**: No production files >400 lines

| File                       | Current | Target | Approach                      |
| -------------------------- | ------- | ------ | ----------------------------- |
| `PgvectorMemoryAdapter.ts` | 529     | <400   | Extract batch fetching logic  |
| `MessageContentBuilder.ts` | ~400    | <400   | IR pattern refactor will help |

**Why low priority**: Large files slow AI assistants but don't directly cause bugs.

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

---

## ESLint Status

**Current**: 72 warnings (down from 110)

High-complexity functions (acceptable, inherent complexity):

- `MessageContentBuilder.ts:buildMessageContent()` - complexity 37
- `SettingsModalFactory.ts:parseDurationInput()` - complexity 26
