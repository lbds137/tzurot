# Tech Debt Tracking

> Last updated: 2026-01-17

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

### Incomplete XML Prompt Migration

**Problem**: Some prompt construction paths still use markdown formatting instead of the new XML format. This is visible when memory content is displayed - referenced messages appear with markdown `**bold**` formatting instead of proper XML tags.

**Example from production logs**:

```
[Referenced content: <quote number="1">
<author display_name="Ashley Graves | שבת" .../>
```

The outer structure is XML, but some inner content may still have markdown artifacts.

**Affected Areas**:

- Memory content storage (persists prompts with mixed formatting)
- Referenced message formatting in some code paths

**Solution**: Audit and update all prompt construction to use consistent XML formatting:

- [ ] Review `PromptBuilder.ts` for any remaining markdown patterns
- [ ] Check `MessageContextBuilder.ts` reference extraction
- [ ] Ensure memories are stored with clean XML formatting

**Source**: Production observation (2026-01-13)

---

### ~~Timeframe/Duration Parsing Duplication~~ ✅ RESOLVED

**Status**: Resolved in PR #481 (2026-01-18)

**Solution Applied**: Consolidated all duration parsing to use the shared `Duration` class from `@tzurot/common-types`:

| Location                                             | Status                             |
| ---------------------------------------------------- | ---------------------------------- |
| `api-gateway/routes/user/memoryBatch.ts`             | ✅ Uses `Duration.parse()`         |
| `api-gateway/routes/admin/usage.ts`                  | ✅ Uses `Duration.parse()`         |
| `bot-client/utils/dashboard/SettingsModalFactory.ts` | ✅ Uses `Duration.parse()`         |
| Incognito mode                                       | ✅ Uses `INCOGNITO_DURATIONS` enum |

**Benefit**: The `Duration` class (via `parse-duration` library) now supports more flexible formats like "2 hours", "30 minutes", "1 day" in addition to compact forms like "2h", "30m", "1d".

**Original Source**: PR #472 code review (2026-01-13)

---

### Date String Validation for Memory Search

**Problem**: `memorySearch.ts:93-97` accepts `dateFrom`/`dateTo` as strings without validation. Invalid date strings (e.g., `"invalid-date"`) cause PostgreSQL errors instead of clean 400 validation errors.

**Current Location**: `services/api-gateway/src/routes/user/memorySearch.ts`

**Solution**: Add date validation in request params:

```typescript
const dateFrom = req.query.dateFrom as string | undefined;
if (dateFrom && isNaN(Date.parse(dateFrom))) {
  sendError(res, ErrorResponses.validationError('Invalid dateFrom format'));
  return;
}
```

**Source**: PR #472 code review (2026-01-13)

---

### Duplicate Detection Temperature Strategy

**Problem**: The duplicate detection "ladder of desperation" uses temperature increase to break API caching. Originally set to 1.1, but some providers (Z.AI, etc.) reject temperature > 1.0 with "Invalid API parameter" errors.

**Current Location**: `services/ai-worker/src/utils/duplicateDetection.ts:107`

**Current Fix**: Capped at 1.0, but this reduces effectiveness of cache-busting.

**Potential Improvements**:

- [ ] Add small random jitter to temperature (e.g., 0.95-1.0) instead of fixed value
- [ ] Use different cache-busting strategies per provider
- [ ] Investigate if frequency_penalty alone is sufficient
- [ ] Consider adding a random token/prefix to break caching

**Source**: Production incident 2026-01-17 (Z.AI returning 400 on temp 1.1)

---

### Per-User Memory Quotas

**Problem**: No limits on how many memories a user can create per persona. At scale, a single user could create 100k+ memories, impacting database performance.

**Solution**: Add memory limits:

- [ ] Add `maxMemoriesPerPersona` to user or system config (default: 10,000)
- [ ] Check count before memory creation
- [ ] Return clear error when limit exceeded
- [ ] Consider auto-pruning oldest non-locked memories when limit reached

**Why MEDIUM**: Not urgent at current user count, but should be addressed before public launch.

**Source**: PR #472 code review (2026-01-13)

---

### Referenced Messages Stored Redundantly in Memories

**Problem**: When a user replies to a message that's already in the conversation context (either main or extended), the referenced message content is included twice in the stored memory - once in the context and once in the `[Referenced content:]` section.

**Impact**:

- Wastes memory storage space
- Causes visual duplication when viewing/editing memories
- May confuse the AI with redundant information

**Solution**: Before including referenced content in memories:

- [ ] Check if the referenced message ID exists in the current conversation context window
- [ ] If present, omit from `[Referenced content:]` section or replace with a brief reference

**Current Location**: Likely in `services/ai-worker/src/services/PromptBuilder.ts` or memory storage logic

**Source**: Production observation (2026-01-13)

---

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

### Unsafe xargs Pattern in Schema Regeneration Script

**Problem**: The `regenerate-pglite-schema.sh` script uses an unsafe shell pattern for sourcing environment variables:

```bash
export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
```

This is vulnerable to shell injection if `.env` contains malicious values.

**Current Location**: `scripts/testing/regenerate-pglite-schema.sh:22`

**Solution**: Use safe parsing like the pre-commit hook does:

```bash
if [ -f "$PROJECT_ROOT/.env" ]; then
    DATABASE_URL=$(grep -E '^DATABASE_URL=' "$PROJECT_ROOT/.env" | cut -d '=' -f2-)
    export DATABASE_URL
fi
```

**Why low priority**:

- `.env` is gitignored (requires local file compromise)
- Script is only run manually by developers
- Pre-commit hook already uses safe pattern (the primary automated path)

**Source**: PR #456 code review (2026-01-08)

---

### Redis Health Check for Session Manager

**Problem**: The session manager initialization in `redis.ts` happens at module load time. If Redis connection fails, dashboards won't work but the bot continues running. Currently there's no programmatic way to check if the session manager is healthy.

**Current Location**: `services/bot-client/src/redis.ts:101-109`

**Solution**: Add a health check function:

```typescript
export function isRedisHealthy(): boolean {
  return redis.status === 'ready' && isSessionManagerInitialized();
}
```

This could be exposed via a `/health` endpoint or used in admin commands.

**Why low priority**:

- Session manager failures are logged clearly
- Dashboard operations fail gracefully (user just sees "expired" message)
- Not blocking for current single-instance deployment

**Source**: PR #483 code review (2026-01-19)

---

### MessageContentBuilder Complexity Reduction

**Problem**: `buildMessageContent()` has complexity 37 (threshold: 15). It orchestrates multiple extraction paths (text, voice, forwarded messages, attachments) in a single function.

**Current Location**: `services/bot-client/src/services/MessageContentBuilder.ts`

**Solution**: Extract helper functions:

- [ ] `extractForwardedContent(message)` - forwarded message extraction (lines 210-254)
- [ ] `processVoiceAttachment(attachment, options)` - voice message handling
- [ ] `extractEmbedContent(embeds)` - embed image/content extraction

**Why low priority**: Function is well-tested with snapshot tests. Complexity is "inherent" due to IR pattern (single entry point orchestrating multiple paths). Refactoring is for readability, not bug prevention.

---

### Shared Authorization Helpers Extraction

**Problem**: The `checkUserAccess` helper appears in multiple personality route files with similar logic.

**Locations**:

- `services/api-gateway/src/routes/user/personality/get.ts:94-120`
- Similar patterns in `update.ts`, `persona/crud.ts`

**Current code pattern**:

```typescript
async function checkUserAccess(
  prisma: PrismaClient,
  userId: string,
  personalityId: string,
  discordUserId: string
): Promise<boolean> {
  if (isBotOwner(discordUserId)) return true;
  // ... additional checks
}
```

**Solution**: Extract common authorization helpers to `services/api-gateway/src/utils/authHelpers.ts`:

- [ ] `checkUserAccess()` - common pattern for personality/persona access checks
- [ ] `requireOwnership()` - throws if user doesn't own resource

**Why low priority**: Each implementation is <30 lines, well-tested via route tests. Duplication is manageable. Extract when adding more routes that need similar patterns.

**Source**: PR #469 code review (2026-01-12)

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
): Record<string, number>;
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

| File                       | Current | Target | Approach                                               |
| -------------------------- | ------- | ------ | ------------------------------------------------------ |
| `PgvectorMemoryAdapter.ts` | 529     | <400   | Extract batch fetching logic                           |
| `DiscordChannelFetcher.ts` | ~550    | <400   | Extract message conversion/mapping logic               |
| `conversationUtils.ts`     | ~530    | <400   | Extract formatting helpers (XML, time gap, etc.)       |
| `MessageContextBuilder.ts` | ~520    | <400   | Extract attachment processing to separate helpers      |
| `user/history.ts`          | 516     | <400   | Apply handler factory pattern (see PR #469 for model)  |
| `user/model-override.ts`   | 417     | <400   | Apply handler factory pattern                          |
| `admin/llm-config.ts`      | 418     | <400   | Already refactored in PR #469, may need further splits |

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

### Audit Log for Destructive Memory Operations

**Problem**: No audit trail when users purge all memories or batch delete. If a user accidentally deletes important memories, there's no record of what was deleted or when.

**Solution**: Log destructive operations to a separate table or structured log:

```typescript
// Log before soft-deleting
logger.info({
  event: 'memory_batch_delete',
  userId,
  personalityId,
  count: deletedCount,
  filters: { olderThan, ... }
}, 'User performed batch delete');
```

**Considerations**:

- [ ] Structured logging vs. dedicated audit table
- [ ] Retention period for audit logs
- [ ] Whether to store deleted content (storage vs. recoverability tradeoff)

**Source**: PR #472 code review (2026-01-13)

---

### Integration Tests for Semantic Memory Search

**Problem**: Memory search tests mock the embedding service. No tests verify the full flow with actual embeddings and pgvector distance calculations.

**Solution**: Add integration tests that:

- [ ] Generate real embeddings (or use deterministic test embeddings)
- [ ] Insert test memories with known embeddings
- [ ] Verify semantic search returns results in correct similarity order
- [ ] Test edge cases: no results, exact match, similar but distinct content

**Current Location**: `services/api-gateway/src/routes/user/memorySearch.test.ts`

**Source**: PR #472 code review (2026-01-13)

---

### Monorepo Script Inheritance for Sub-Packages

**Problem**: When running `pnpm --filter @scope/package lint`, it fails with "no script" if the package doesn't define its own `lint` or `typecheck` script. This forces either:

- Duplicating identical scripts across all package.json files (maintenance burden)
- Remembering to run from root instead of filtering

**Related Issue - `lint:errors` Not Available at Package Level**:

Root has `lint:errors` (runs eslint with `--quiet` to show only errors), but individual packages don't. The workaround of passing `-- --quiet` doesn't work:

```bash
# This fails - "--quiet" interpreted as file pattern
pnpm --filter @tzurot/bot-client lint -- --quiet
# Error: No files matching the pattern "--quiet" were found
```

**Current Impact**: Minor annoyance when testing individual packages.

**Potential Solutions** (from MCP council research):

1. **`pnpm exec` approach**: Bypass scripts entirely with `pnpm --filter pkg exec eslint .`
2. **Root helper scripts**: Add `"x:lint": "pnpm exec eslint"` to root
3. **Sync script**: Auto-copy standard scripts to all packages that don't have custom ones
4. **Switch to Nx**: Has native "inferred tasks" that auto-detect from config files

**Recommended approach**: Option 3 (sync script) - maintains Turbo caching while minimizing maintenance.

**Why low priority**: Workaround exists (run from root), only affects developer convenience.

**Source**: PR #474 discussion (2026-01-17), updated 2026-01-17

---

### Commitlint Scope Auto-Discovery

**Problem**: Commitlint scopes are hardcoded in `commitlint.config.cjs`. When new packages are added (e.g., `@tzurot/embeddings`), the scope list must be manually updated or commits will fail validation.

**Current Location**: `commitlint.config.cjs:10-26`

**Current Workaround**: Manual sync with TODO comment reminding to keep in sync.

**Solution**: Generate scopes dynamically from `pnpm-workspace.yaml`:

```javascript
// commitlint.config.cjs
const { readFileSync, readdirSync, existsSync } = require('fs');
const { join, basename } = require('path');
const { parse } = require('yaml');

function getWorkspaceScopes() {
  const workspaceFile = join(__dirname, 'pnpm-workspace.yaml');
  const workspace = parse(readFileSync(workspaceFile, 'utf8'));

  const scopes = new Set(['hooks', 'docs', 'deps', 'tests', 'ci']); // Non-package scopes

  for (const pattern of workspace.packages) {
    if (pattern.endsWith('/*')) {
      // Glob pattern like 'packages/*' - expand directory
      const dir = join(__dirname, pattern.slice(0, -2));
      if (existsSync(dir)) {
        readdirSync(dir).forEach(name => scopes.add(name));
      }
    } else {
      // Direct path like 'scripts' - use as-is
      scopes.add(basename(pattern));
    }
  }

  return [...scopes].sort();
}

module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [2, 'always', getWorkspaceScopes()],
    // ...
  },
};
```

This reads from `pnpm-workspace.yaml` (the single source of truth) and expands glob patterns to discover actual package names.

**Why low priority**: Easy workaround (add manually), only affects developers on rare occasions.

**Source**: Commit `9cb9720f` (2026-01-17)

---

### Singleton Export Pattern Cleanup

**Problem**: 18 module-level singletons detected by `@tzurot/no-singleton-export` ESLint rule. These make testing harder because instances are created at import time.

**Locations** (run `pnpm lint 2>&1 | grep @tzurot/no-singleton-export` for full list):

- `services/api-gateway/src/queue/` - BullMQ Queue, FlowProducer, QueueEvents
- `services/api-gateway/src/services/` - RedisService, VoiceTranscriptCache, VisionDescriptionCache
- Various `new Set()` exports for allowed values

**Legitimate singletons** (intentional for connection pooling):

- Redis connections
- BullMQ queue instances

**Candidates for refactoring**:

- Set collections should be `as const` arrays instead
- Date exports should be values, not `new Date()` instances

**Rule status**: Enabled as warning in `eslint.config.js`. Does not block CI.

**Source**: PR #455 code review (2026-01-08)

---

## Deferred (Not Worth It Yet)

These items are optimizations for problems we don't have at current scale:

| Item                              | Why Deferred                                                                      |
| --------------------------------- | --------------------------------------------------------------------------------- |
| Schema versioning for BullMQ jobs | No breaking changes yet, add when needed                                          |
| Contract tests for HTTP API       | Single consumer (bot-client), integration tests catch breaks                      |
| Redis pipelining (2 calls → 1)    | Redis is fast enough at current traffic                                           |
| Lua script pre-compilation        | Negligible perf gain                                                              |
| BYOK `lastUsedAt` on actual usage | Nice-to-have, not breaking anything                                               |
| Dependency Cruiser                | ESLint already catches most issues                                                |
| Validator library expansion       | Add when needed: `validateEmail()`, `validateDiscordSnowflake()`, `validateUrl()` |
| Handler factory generator         | `pnpm generate:route user/feature` template - add when creating many new routes   |

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
- ~~`SettingsModalFactory.ts:parseDurationInput()` - complexity 26~~ (simplified in PR #481, now uses Duration class)
