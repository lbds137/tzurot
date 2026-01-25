# Tech Debt Tracking

> Last updated: 2026-01-25 (elevated Zod schema/interface mismatch to CRITICAL)

Technical debt prioritized by ROI: bug prevention, maintainability, and scaling readiness.

---

## Priority 1: HIGH (Blocking Issues)

### Context Window Cutoff Mismatch (Quoted Messages Duplication)

**Problem**: Quoted/referenced messages sometimes appear duplicated in prompts - once in extended context and again as a `<quote>` element. This happens for older messages due to mismatched timestamp cutoffs between:

1. **Extended context** (Discord fetch): Uses `maxAge` and `maxMessages` limits
2. **DB conversation history**: Uses `contextEpoch` (STM reset) + `MAX_HISTORY_FETCH` limit

When a user replies to a message that's old enough to be outside one boundary but inside another, it gets included twice.

**Partial Fix Applied** (2026-01-25): Added `getChannelHistory()` that fetches ALL channel messages (not filtered by personality) when extended context is enabled. This fixed the case where messages to other AIs were missing from DB history.

**Remaining Issue**: Timestamp cutoffs still don't align. Need to:

1. Audit how `maxAge`, `maxMessages`, and `contextEpoch` interact
2. Ensure the deduplication logic in `MessageReferenceExtractor` accounts for both sources
3. Consider aligning the DB history fetch timestamp with the oldest extended context message
4. Add logging to track when duplication occurs for debugging

**Files involved**:

- `services/bot-client/src/services/MessageContextBuilder.ts` - Fetches both sources
- `services/bot-client/src/services/DiscordChannelFetcher.ts` - Extended context fetch
- `packages/common-types/src/services/ConversationHistoryService.ts` - DB history fetch
- `services/bot-client/src/handlers/MessageReferenceExtractor.ts` - Deduplication logic

**Source**: Production observation (2026-01-25)

---

### Multi-AI Conversations: Role Attribution

**Problem**: Messages from other AI personalities show as `role="user"` in the chat log, which confuses the responding AI. When one personality (e.g., Lilith) sends a message, and another personality (e.g., COLD) responds, the original message from Lilith appears as `role="user"` because Discord webhooks are treated as user messages.

**Impact**: The responding AI may incorrectly interpret AI-generated messages as human input, leading to confusion about who said what in group conversations.

**Solution Options**:

1. Add `source="personality:{slug}"` attribute to identify AI-generated messages
2. Track which messages were sent via bot webhooks and mark them as assistant
3. Add personality IDs as participants with short blurbs (similar to user personas)

**Related**: Need `quickSummary` field in character cards for conversational context without overwhelming the context window.

**Source**: Prompt review (2026-01-24)

---

### Location Format Inconsistency in Quoted Messages

**Problem**: The `location` attribute in `<quote>` elements uses a different format than `<location>` elsewhere:

- Quote location: Plain text like "Server: X, Category: Y, Channel: #Z"
- Environment location: Proper XML with `<server name="..."/>` etc.

**Impact**: Inconsistent formatting for the LLM, potential confusion.

**Solution**: Create shared `formatLocationContext()` helper used by both EnvironmentFormatter and quoted message location formatting.

**Source**: Prompt review (2026-01-24)

---

### 🚨 Zod Schema/TypeScript Interface Mismatch (CRITICAL - Multiple Incidents)

**Problem**: Zod schemas and TypeScript interfaces get out of sync. By default, Zod **strips fields not in the schema** during parsing. When we add fields to TS interfaces but forget the Zod schema, data silently disappears at validation boundaries.

**Incidents**:

- **2026-01-25**: `personalityId` and `personalityName` added to `JobContext.conversationHistory` TS interface but not `apiConversationMessageSchema`. Multi-AI attribution broken for WEEKS because fields were stripped during validation.
- **2026-01-24**: `avatarUpdatedAt` defined in schema but `.optional()` let it pass when never populated from DB.
- Multiple similar incidents in the past.

**Impact**: Features appear to work in unit tests (which may not go through Zod) but fail in production when data crosses service boundaries. Debugging is extremely difficult because the fields simply vanish.

**Solution** (HIGH PRIORITY):

1. **Enforce schema-type sync with tests**:

   ```typescript
   // Contract test: every field in TS interface must be in Zod schema
   it('apiConversationMessageSchema matches JobContext.conversationHistory type', () => {
     const schemaKeys = Object.keys(apiConversationMessageSchema.shape);
     const interfaceKeys = ['id', 'role', 'content', ...]; // from interface
     expect(schemaKeys.sort()).toEqual(interfaceKeys.sort());
   });
   ```

2. **Use `.passthrough()` or `.strict()` during development**:
   - `.passthrough()` - keeps unknown fields (safer)
   - `.strict()` - throws on unknown fields (catches sync issues early)
   - Change to neither for production (current default strips)

3. **Audit all schema/interface pairs**:
   - `apiConversationMessageSchema` ↔ `JobContext.conversationHistory`
   - `generateRequestSchema` ↔ `GenerateRequest`
   - All route request/response schemas

4. **Consider code generation**: Use a tool to generate TS types from Zod schemas (single source of truth) instead of maintaining both manually.

**Files to audit**: `packages/common-types/src/types/schemas.ts`, `jobs.ts`, all route schemas

**Source**: Multi-AI attribution bug (2026-01-25), Avatar bug (2026-01-24)

---

### Timer Patterns Blocking Horizontal Scaling

**Problem**: `setInterval` patterns prevent running multiple instances (race conditions).

| File                              | Pattern                | Migration             |
| --------------------------------- | ---------------------- | --------------------- |
| `LlmConfigResolver.ts`            | Cache cleanup interval | BullMQ repeatable job |
| `WebhookManager.ts`               | Webhook cleanup        | BullMQ repeatable job |
| `DatabaseNotificationListener.ts` | Reconnection timeout   | Redis coordination    |

**Solution**: Create "SystemQueue" in BullMQ with repeatable jobs and deterministic job IDs.

---

### InteractionAlreadyReplied Architectural Fix

**Problem**: Commands receive raw interaction with `deferReply()` available, but calling it crashes if top-level already deferred. Has caused multiple production incidents.

**Current Workaround**: Runtime shim in `safeInteraction.ts` makes `deferReply()` idempotent.

**Recommended Solution**: Hybrid Facade Pattern - pass `SafeCommandContext` that doesn't have `deferReply()` method at all (compile-time safety).

**Source**: MCP council analysis (2026-01-20)

---

### Voice Message Transcripts Corrupted by Sync Bug

**Problem**: The opportunistic sync in `DiscordChannelFetcher.contentsDiffer()` was overwriting voice message transcripts with empty strings. Voice messages have empty text content in Discord but transcripts stored in `conversation_history.content`. The sync saw them as "edited" and wiped the transcripts.

**Impact**: Unknown number of voice message records now have `content: ""` but the transcripts exist in associated memories (since memories were created before the sync ran).

**Fix Applied**: Added check in `contentsDiffer()` to never overwrite non-empty DB content with empty Discord content (PR pending).

**Recovery Script Needed**:

1. Find conversation_history records where:
   - `content = ''` (empty)
   - `edited_at IS NOT NULL` (was modified by sync)
   - Has associated memory in `memories` table with non-empty content
2. Parse the memory content to extract the transcript (format: `{user}: [transcript]\n\n{assistant}: [response]`)
3. Update conversation_history.content with the extracted transcript
4. Reset `edited_at` to `NULL` or set to a marker value

**Files**: `scripts/data/fix-voice-transcripts.ts` (to be created)

**Source**: Production data corruption discovered 2026-01-25

---

## Priority 2: MEDIUM

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

#### Incomplete XML Prompt Migration

Some prompt paths still use markdown. Audit `PromptBuilder.ts` and `MessageContextBuilder.ts`.

**Source**: Production observation (2026-01-13)

---

## Priority 3: LOW (Polish & Documentation)

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
| discord:XXXX format             | Document when/why used, resolution to UUIDs       |
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
| `DiscordChannelFetcher.ts` | ~550    | Extract message conversion               |
| `conversationUtils.ts`     | ~530    | Extract formatting helpers               |
| `MessageContextBuilder.ts` | ~520    | Extract attachment processing            |
| `user/history.ts`          | 516     | Handler factory pattern                  |

**Source**: PR #506 browse UX improvements (2026-01-24)

### Testing

| Item                               | Description                                                  |
| ---------------------------------- | ------------------------------------------------------------ |
| Mixed UUID + discord: format       | No test for `getAllParticipantPersonas()` with mixed formats |
| Semantic memory search integration | Tests mock embeddings, need real pgvector tests              |
| Audit log for memory operations    | Log before batch delete for recoverability                   |

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

**Current**: 46 warnings (14 bot-client, 28 api-gateway, 4 ai-worker)

**91 eslint-disable directives** - needs audit to ensure none are masking real issues:

```bash
grep -r "eslint-disable" services packages --include="*.ts" | wc -l
```

High-complexity functions (acceptable, inherent complexity):

- `MessageContentBuilder.ts:buildMessageContent()` - complexity 30
- `EmbedParser.ts:parseEmbed()` - complexity 33
- `MessageContextBuilder.ts:buildContext()` - complexity 41
