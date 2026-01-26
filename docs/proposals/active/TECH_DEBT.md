# Tech Debt Tracking

> Last updated: 2026-01-26

Technical debt prioritized by ROI: bug prevention, maintainability, and scaling readiness.

---

## Priority 1: HIGH (Blocking Issues)

### Extended Context Pipeline Simplification

**Problem**: The context pipeline (Discord → bot-client → ai-worker → LLM) is overly complex and brittle. Multiple code paths exist for "extended context on" vs "extended context off", creating maintenance burden and causing bugs.

**Symptoms**:

- Forwarded messages losing content/images in certain paths
- Voice message transcripts not appearing in some scenarios
- Image descriptions not injected correctly for forwarded images
- Content recovery logic needed for corrupted DB entries
- Constant bugs from inconsistent data flow between services

**Root Cause**: Extended context was designed as an optional feature with toggle. This created parallel code paths that diverge and get out of sync.

**Solution**:

1. **Remove the toggle** - Always use extended context (keep max messages/age/images settings)
2. **Remove dead code paths** - Eliminate all "if not extended context" branches
3. **Unify the pipeline** - Single, well-tested path from Discord to LLM input
4. **Consolidate types** - `ConversationHistoryEntry` should carry ALL needed data through the pipeline

**Files likely affected**:

- `services/bot-client/src/services/DiscordChannelFetcher.ts`
- `services/bot-client/src/services/MessageContextBuilder.ts`
- `services/ai-worker/src/jobs/utils/conversationUtils.ts`
- `services/ai-worker/src/jobs/handlers/pipeline/*.ts`
- Settings/config that expose the toggle

**Source**: Production bugs from extended context inconsistencies (2026-01-25, 2026-01-26)

### LTM Summarization (Shapes.inc Style)

**Problem**: Current approach stores verbatim conversation turns in the database. With extended context becoming the default, this is redundant - recent messages are already fetched from Discord. Storing verbatim turns wastes storage and provides no additional value.

**Solution**: Replace verbatim storage with LLM-generated summaries (shapes.inc approach):

1. **Configurable grouping** - Summarize after N messages (5, 10, 50) or time window (1h, 4h, 24h)
2. **Separate LLM call** - Use a fast/cheap model for summarization (not the personality's model)
3. **Store summaries as LTM** - These become the long-term memory, not raw turns
4. **Extended context provides recency** - Discord fetch handles recent verbatim context

**Benefits**:

- Reduced storage (summaries vs verbatim)
- Better context compression for LTM retrieval
- Cleaner separation: Discord = recent, DB = summarized history
- Aligns with industry practice (shapes.inc, Character.AI)

**Dependencies**: Requires Extended Context Pipeline Simplification first

**Source**: Architecture discussion (2026-01-26)

### Memories Table Cleanup & Migration

**Problem**: The `memories` table has two different formats coexisting:

1. **Shapes.inc imports** - Summarized memories from the old system
2. **Tzurot v3 memories** - Verbatim conversation turns (redundant with extended context)

These need to be unified into a single, optimized format.

**Solution**:

1. **Design unified format** - Draw inspiration from both sources for optimal structure
2. **One-time migration** - Convert existing tzurot-v3 memories to new format
3. **Summarization pass** - Run existing verbatim memories through the summarizer to compress them (matching what new memories will produce)
4. **Schema update** - May require migration to adjust columns/indexes

**Considerations**:

- Preserve semantic meaning during summarization
- Handle edge cases (very short memories, already-summarized content)
- Batch processing for large memory sets
- Rollback strategy if summarization quality is poor

**Dependencies**: Requires LTM Summarization implementation first

**Source**: Architecture discussion (2026-01-26)

### Admin Debug Doesn't Work with Failures

**Problem**: `/admin debug` can't show diagnostics for failed jobs. The diagnostic flight recorder only captures successful generations.

**Impact**: When debugging "why didn't user get a reply?", the most important cases (failures) have no diagnostic data.

**Solution**: Record diagnostics on failure path, not just success path. May need to capture partial state at failure point.

**Source**: Bug intake 2026-01-25

---

## Priority 2: MEDIUM

### Thinking Tag Leaking (Needs Investigation)

**Problem**: `<thinking>` tags from reasoning models occasionally appear in AI output when they should be stripped.

**Location**: Likely `reasoningModelUtils.ts:stripThinkingTags()` or upstream processing.

**Action**: Investigate when/why stripping fails. May be edge cases in tag format or processing order.

**Source**: Bug intake 2026-01-25

### Voice Message Transcript Recovery (Optional)

**Problem**: The opportunistic sync bug (now fixed) overwrote some voice message transcripts with empty strings.

**Status**: Mitigated. Extended context now has fallback logic:

1. Try DB lookup (authoritative)
2. If DB fails → extract transcript from bot's reply message in Discord history

This ensures voice transcripts are recovered even when DB records are corrupted.

**Remaining impact**: Only affects messages where bot reply is also outside the extended context window. These age out in 30 days anyway.

**Source**: Production data corruption discovered 2026-01-25, fallback implemented 2026-01-25

### Zod Schema/TypeScript Interface Mismatch (Preventive)

**Problem**: Zod schemas and TypeScript interfaces get out of sync. By default, Zod **strips fields not in the schema** during parsing. When we add fields to TS interfaces but forget the Zod schema, data silently disappears at validation boundaries.

**Status**: Currently working after 2026-01-25 fix. This is preventive to avoid future incidents.

**Past Incidents**:

- **2026-01-25**: `personalityId` and `personalityName` stripped - Multi-AI attribution broken for weeks
- **2026-01-24**: `avatarUpdatedAt` never populated from DB

**Solution**:

1. **Enforce schema-type sync with tests** - Contract tests ensuring Zod schema keys match interface fields
2. **Use `.passthrough()` or `.strict()` during development** to catch issues early
3. **Audit schema/interface pairs**: `apiConversationMessageSchema`, `generateRequestSchema`, route schemas
4. **Consider code generation**: Generate TS types from Zod schemas (single source of truth)

**Files to audit**: `packages/common-types/src/types/schemas.ts`, `jobs.ts`, all route schemas

---

### Epic: API Validation & Response Consistency

Related items for systematic API quality improvement.

#### Inconsistent Request Validation (Epic Candidate)

**Problem**: Mix of manual type checks, Zod schemas, and `as Type` casting. Some routes validate strictly, others accept malformed requests.

**Solution**: Standardize on Zod schemas for all POST/PUT bodies. Create `schemas/` directory, use `safeParse` consistently.

**Files to audit**: `routes/user/*.ts`, `routes/admin/*.ts`, `routes/internal/*.ts`

**Source**: PR #500 (2026-01-22)

#### API Response Consistency (CRUD Endpoints)

**Problem**: Same resource returns different fields from GET vs POST vs PUT. Caused `/preset create` crash (missing `params` field).

**Solution**: Shared response builder functions per resource type.

**Source**: PR #500 production bug (2026-01-22)

#### Date String Validation for Memory Search

**Problem**: `dateFrom`/`dateTo` accepted without validation - invalid dates cause PostgreSQL errors instead of 400.

**Source**: PR #472 (2026-01-13)

---

### Epic: Dashboard UX Polish (PR #505 Items)

Small fixes identified during Slash Command UX Epic review.

#### Delete Button Redundant Ownership Checks

**Location**: `character/browse.ts:679` - combines `canEdit` with explicit `ownerId` check. Document why both needed or simplify.

#### Clone Name Edge Case

**Location**: `preset/dashboardButtons.ts:364-375` - regex for "(Copy N)" fails on "Preset (Copy) (Copy)".

#### Clone Session Cleanup

**Location**: `preset/dashboardButtons.ts:426` - deleting old session may break original dashboard message.

#### Modal Submit Silent Failure

**Location**: `character/dashboard.ts:164-168` - failed updates logged but user not notified.

#### Dashboard Refresh Race Condition

**Problem**: Session-cached `isGlobal` becomes stale if preset visibility changed elsewhere → 404 on refresh.

**Source**: PR #501 (2026-01-22)

---

### Epic: Incognito Mode Improvements

#### String Matching for Status

**Problem**: `data.message.includes('already')` is brittle. Add explicit `wasAlreadyActive` boolean to API response.

**Source**: PR #494 (2026-01-20)

#### Parallel API Calls for Session Names

**Problem**: Status command fires up to 100 parallel API calls to fetch personality names. Have API return names with sessions instead.

**Source**: PR #494 (2026-01-20)

---

### Epic: Duplicate Detection Hardening

#### Temperature Strategy

**Problem**: Cache-busting temp 1.1 rejected by some providers (Z.AI). Capped at 1.0 but less effective.

**Solution**: Random jitter 0.95-1.0, or provider-specific strategies.

**Source**: Production incident 2026-01-17

#### Unbounded History Scanning

**Problem**: Scans entire history looking for 5 assistant messages. Add `MAX_SCAN_DEPTH = 100`.

**Source**: PR #453 (2026-01-07)

#### Logging Verbosity

**Problem**: INFO log for EVERY response. After Feb 2026, downgrade PASSED to DEBUG, keep NEAR-MISS/DUPLICATE at INFO.

**Source**: PR #453 (2026-01-07)

---

### Epic: Memory System

#### Per-User Quotas

**Problem**: No limits on memories per persona. Add `maxMemoriesPerPersona` (default: 10,000).

**Source**: PR #472 (2026-01-13)

#### Redundant Referenced Messages

**Problem**: Reply to message in context stores it twice (context + `[Referenced content:]`). Check if already in context window.

**Source**: Production observation (2026-01-13)

---

### Epic: Observability & Debugging

#### Basic Structured Logging

Add event types: `rate_limit_hit`, `dedup_cache_hit`, `pipeline_step_failed`, `llm_request` with latency/tokens.

#### Admin Debug Filtering

Add `/admin debug recent` with personality/user/channel filters. API already supports it.

**Source**: PR #502 (2026-01-22)

---

### Other Medium Items

#### N+1 Query Pattern in UserReferenceResolver

**Problem**: `resolveUserReferences()` performs sequential database queries in a loop. Each match triggers a separate `findUnique`/`findFirst` call to look up user/persona data.

**Location**: `services/ai-worker/src/services/UserReferenceResolver.ts`

**Current pattern**:

```typescript
for (const match of [...text.matchAll(PATTERN)]) {
  const persona = await this.resolveByShapesUserId(shapesUserId); // DB call per match
}
```

**Impact**: Low in practice since personality prompts typically have 0-3 user references. Would become problematic if used on longer documents with many references.

**Solution**: Batch extraction pattern - collect all IDs first, fetch in single query, then replace.

```typescript
const shapesIds = [...text.matchAll(SHAPES_PATTERN)].map(m => m[2]);
const discordIds = [...text.matchAll(DISCORD_PATTERN)].map(m => m[1]);
const personas = await this.batchResolve(shapesIds, discordIds);
// Then apply replacements using the pre-fetched map
```

**Source**: PR #515 code review (2026-01-26)

#### Split Large Fetcher/Formatter Files (Next Touch)

**Problem**: These files and their tests have grown too large, hurting maintainability:

| Source File                | Lines | Test File                       | Lines |
| -------------------------- | ----- | ------------------------------- | ----- |
| `DiscordChannelFetcher.ts` | ~600  | `DiscordChannelFetcher.test.ts` | ~1900 |
| `conversationUtils.ts`     | ~720  | `conversationUtils.test.ts`     | ~1900 |

**Trigger**: Next time either file is touched, split BOTH the source and test files.

**Suggested splits**:

- `DiscordChannelFetcher.ts` → Extract `MessageConverter.ts` (message transformation), `SyncService.ts` (DB sync logic)
- `conversationUtils.ts` → Extract `XmlFormatter.ts` (message XML formatting), `LengthCalculator.ts` (budget estimation)

**Source**: Extended context consistency fixes (2026-01-25)

---

## Priority 3: LOW (Polish & Documentation)

### Scaling Preparation (Epic)

Timer patterns that would block horizontal scaling. Not urgent since single-instance is sufficient for current traffic.

| File                         | Pattern                  | Migration             |
| ---------------------------- | ------------------------ | --------------------- |
| `LlmConfigResolver.ts`       | Cache cleanup interval   | BullMQ repeatable job |
| `WebhookManager.ts`          | Webhook cleanup interval | BullMQ repeatable job |
| `ResponseOrderingService.ts` | Cleanup interval         | BullMQ repeatable job |
| `notificationCache.ts`       | Module-level interval    | Injectable or BullMQ  |

**Solution**: Create "SystemQueue" in BullMQ with repeatable jobs and deterministic job IDs.

---

### Admin Command UX

| Item                             | Description                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| `/admin servers` list treatment  | Barebones output, doesn't match browse pattern used elsewhere. Apply standard list/browse pattern |
| `/admin debug` PluralKit support | Can't lookup by response message ID, only trigger message. PK proxies change message IDs          |

**Source**: Bug intake 2026-01-25

### Code Quality

| Item                                | Location                            | Fix                                             |
| ----------------------------------- | ----------------------------------- | ----------------------------------------------- |
| **Audit eslint-disable directives** | 91 across codebase                  | Review each, remove lazy suppressions           |
| Unused `_activePersonaName` param   | `PromptBuilder.ts:119`              | Remove parameter after verifying no callers use |
| Autocomplete badge magic number     | `autocompleteFormat.ts:117`         | Extract `MAX_STATUS_BADGES = 2`                 |
| Autocomplete truncation complex     | `autocompleteFormat.ts:139-152`     | Extract helper function                         |
| Error serializer magic number       | `logger.ts:187`                     | Extract `MAX_RAW_ERROR_LENGTH = 500`            |
| Use MessageRole enum                | `duplicateDetection.ts:552`         | `MessageRole.Assistant` not `'assistant'`       |
| DRY role distribution               | GenerationStep + duplicateDetection | Extract `getRoleDistribution()` helper          |
| MessageContentBuilder complexity    | complexity 30                       | Extract helpers (well-tested, low priority)     |
| Shared auth helpers                 | personality routes                  | Extract `checkUserAccess()` to `authHelpers.ts` |

### Documentation

| Item                            | Description                                       |
| ------------------------------- | ------------------------------------------------- |
| Duplicate detection docs        | Document Dice coefficient choice, O(n) complexity |
| Stop sequence participant limit | Document 5-participant limit, truncation behavior |
| PII in diagnostic logs          | Add note to tzurot-security skill                 |

### DX/Tooling

| Item                        | Description                                                       | Workaround       |
| --------------------------- | ----------------------------------------------------------------- | ---------------- |
| Legacy testing scripts      | `scripts/testing/*.js` - Jest-era scripts, may be obsolete        | Review/remove    |
| Unsafe xargs in script      | `regenerate-pglite-schema.sh` shell injection                     | Use safe parsing |
| Monorepo script inherit     | `pnpm --filter` fails if no script defined                        | Run from root    |
| Commitlint scope auto       | Hardcoded scopes in `commitlint.config.cjs`                       | Add manually     |
| Singleton export cleanup    | 18 module-level singletons detected by ESLint                     | Warning only     |
| update-deps regex constants | `update-deps.ts:94,104` - complex regex inline, extract as consts | Works as-is      |
| update-deps YAML fragility  | `update-deps.ts` manual YAML parsing - fragile if format changes  | Works for now    |
| boundaries depth limit      | `check-boundaries.ts` findTypeScriptFiles has no recursion depth  | Low risk         |
| logs follow mode tests      | `logs.ts` streaming mode (spawn) lacks test coverage              | Core path tested |

**Source**: PR #510 code review (2026-01-24)

### Edge Cases

| Item                            | Description                                                    |
| ------------------------------- | -------------------------------------------------------------- |
| Avatar filesystem cache stale   | `/data/avatars/{slug}.png` not invalidated on direct DB update |
| Voice transcript race           | Forwarded voice before transcription completes                 |
| Redis health check              | No programmatic way to check session manager health            |
| Diagnostic retention config     | Hardcoded 24h, make env var `DIAGNOSTIC_RETENTION_HOURS`       |
| Diagnostic finish reason colors | Only `length` highlighted, add `error`/`content_filter` colors |

### Large File Reduction

Target: <500 lines (error), <400 lines (ideal). Lower priority since AI-only impact.

| File                       | Current | Approach                                 |
| -------------------------- | ------- | ---------------------------------------- |
| `character/browse.ts`      | 794     | Extract buildBrowsePage to browseBuilder |
| `character/dashboard.ts`   | 692     | Extract back handler to dashboardButtons |
| `preset/browse.ts`         | 610     | Extract buildBrowsePage to browseBuilder |
| `PgvectorMemoryAdapter.ts` | 529     | Extract batch fetching                   |
| `MessageContextBuilder.ts` | ~520    | Extract attachment processing            |
| `user/history.ts`          | 516     | Handler factory pattern                  |

**Note**: `DiscordChannelFetcher.ts` and `conversationUtils.ts` moved to Priority 2 (Medium) - see "Split Large Fetcher/Formatter Files".

**Source**: PR #506 browse UX improvements (2026-01-24)

### Testing

| Item                               | Description                                     |
| ---------------------------------- | ----------------------------------------------- |
| Semantic memory search integration | Tests mock embeddings, need real pgvector tests |
| Audit log for memory operations    | Log before batch delete for recoverability      |

---

## Deferred (Not Worth It Yet)

| Item                              | Why Deferred                                  |
| --------------------------------- | --------------------------------------------- |
| Schema versioning for BullMQ jobs | No breaking changes yet                       |
| Contract tests for HTTP API       | Single consumer, integration tests sufficient |
| Redis pipelining                  | Fast enough at current traffic                |
| BYOK `lastUsedAt` tracking        | Nice-to-have, not breaking                    |
| Dependency Cruiser                | ESLint catches most issues                    |
| Handler factory generator         | Add when creating many new routes             |

---

## ESLint Status

**Current**: 37 warnings (6 bot-client, 28 api-gateway, 3 ai-worker)

High-complexity functions (acceptable, inherent complexity):

- `MessageContentBuilder.ts:buildMessageContent()` - complexity 30
- `EmbedParser.ts:parseEmbed()` - complexity 33
- `MessageContextBuilder.ts:buildContext()` - complexity 41
