# Tech Debt Tracking

> Last updated: 2026-01-04

This document consolidates all technical debt tracking for Tzurot v3. It replaces the previous `TECH_DEBT_SPRINT.md` and `TECH_DEBT_PRIORITIZATION_2025-11-20.md` documents.

---

## Active Work

### Code Quality (ESLint Warnings)

**Current**: 72 warnings (down from 110)
**Target**: Continue reducing where practical

Remaining high-complexity areas:
- `MessageContentBuilder.ts` - `buildMessageContent()` complexity 37 (needs IR pattern refactor, deferred)
- `SettingsModalFactory.ts` - `parseDurationInput()` complexity 26 (parsing logic inherent)

### Phase 1: Quick Wins ✅ COMPLETE

- [x] ESLint rules enhancement (no-explicit-any set to error)
- [x] Document ESLint flat config vs legacy in CLAUDE.md
- [x] Test coverage for entry points (api-gateway, ai-worker, bot-client)
- [x] Address TODO comments (health check, callback URL, rate limiting)

### Phase 2: Architectural Improvements ✅ COMPLETE

- [x] Split api-gateway/index.ts (558 → 259 lines, -51%)
- [x] Split LLMGenerationHandler.ts (617 → 131 lines, -79%) - Pipeline pattern
- [x] Migrate in-memory caches to Redis (deduplication, rate limiting)

### Phase 3: Testing & Reliability (Partial)

- [ ] Add schema versioning to BullMQ job payloads
- [ ] Add contract tests for HTTP API responses
- [ ] Consider Dependency Cruiser for architecture linting
- [ ] Snapshot tests for PromptBuilder outputs

---

## High Priority Backlog

### DRY Message Extraction Refactor

**Plan**: `.claude/plans/rustling-churning-pike.md`
**Problem**: Two parallel message processing paths (main vs extended context) keep diverging
**Solution**: Intermediate Representation (IR) pattern - single extraction function

Recent bugs from this pattern:
- 2026-01-03: Forwarded message attachments not extracted in extended context
- 2026-01-03: Google API rejected >16 stop sequences
- Previous: Extended context missing embed images, voice transcript inconsistencies

### Performance Optimization

- [ ] Redis pipelining for deduplication (currently 2 calls per request)
- [ ] Pre-compile Lua script for rate limiter
- [ ] Return TTL from Lua script (avoid extra Redis call when rate limited)
- [ ] Batch fetching for sibling chunks in PgvectorMemoryAdapter

### Monitoring & Observability

- [x] Add error.stack to pipeline metadata
- [ ] Track metrics: rate limit hit rate, deduplication cache hit rate, pipeline step failure distribution

### BYOK Improvements

- [ ] Update `lastUsedAt` on actual API key usage (not just /wallet test)

---

## Known Scaling Blockers (Timer Patterns)

Timer-based cleanup patterns that prevent horizontal scaling:

| File | Pattern | Migration Path |
|------|---------|----------------|
| `LlmConfigResolver.ts` | Cache cleanup interval | BullMQ repeatable job |
| `WebhookManager.ts` | Webhook cleanup interval | BullMQ repeatable job |
| `DatabaseNotificationListener.ts` | Reconnection timeout | Redis-based coordination |

---

## Completed Large File Refactoring

| File | Before | After | Method |
|------|--------|-------|--------|
| `ConversationHistoryService.ts` | 704 | 455 | Extracted ConversationRetentionService |
| `api-gateway/index.ts` | 558 | 259 | Split into bootstrap/, middleware/, routes/ |
| `LLMGenerationHandler.ts` | 617 | 131 | Pipeline pattern with 6 steps |
| `PgvectorMemoryAdapter.ts` | 901 | 529 | Extracted memoryUtils.ts + PgvectorQueryBuilder |
| `MentionResolver.ts` | 527 | 473 | Extracted MentionResolverTypes.ts |
| `PromptBuilder.ts` | 627 | 496 | Extracted PersonalityFieldsFormatter |
| `history.ts` | 554 | 496 | Extracted historyContextResolver |
| `channel/list.ts` | 512 | 488 | Extracted listTypes.ts |
| `character/view.ts` | 508 | 478 | Extracted viewTypes.ts |

---

## Success Metrics

- [x] All entry points have basic smoke tests
- [x] Redis-backed rate limiter and deduplication (horizontal scaling ready)
- [x] All TODOs resolved or converted to tracked issues
- [ ] No files > 400 lines in production code (closest: PgvectorMemoryAdapter.ts at 529)
- [ ] `any` usage reduced by 50% (692 instances, mostly test files)

---

## Key Insights (from Code Quality Audit)

1. **Pipeline Pattern for LLM Generation** - Break handler into composable steps
2. **Gateway Decomposition** - Strict Route-Controller-Service layers
3. **Memory Adapter Split** - Separate storage mechanism from domain logic
4. **Shadow Mode for Refactoring** - Run old and new code in parallel for validation
5. **BullMQ for Scheduled Cleanup** - Replace setInterval with repeatable jobs

---

## Positive Findings

- No circular cross-service imports (good service boundaries)
- Constants centralized in @tzurot/common-types/constants
- Strong Zod validation throughout
- Route extraction patterns already established
