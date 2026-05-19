## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

### ✨ `/admin metrics` Discord command — give the gateway `/metrics` endpoint a UX

The `/metrics` endpoint (post-PR #1048) requires service auth and exposes queue depth, completed/failed counts, dedup cache size, and uptime. No consumer in-bot today. Build a bot-owner-only `/admin metrics` slash command that fetches via `callGatewayApi('/metrics')` (using the existing `INTERNAL_SERVICE_SECRET` path) and renders an ephemeral embed: queue waiting/active/completed/failed, cache size, uptime as a human duration.

**Pattern reference:** existing `/admin health` command in `services/bot-client/src/commands/admin/health.ts`. ~1-2hr.

Surfaced 2026-05-17 PR #1048 review. Triaged 2026-05-19 (prod-issue ping race resolved — original "wait until" trigger now met).

### 🐛 Detect and Retry Inadequate LLM Responses

LLMs occasionally return a 200 OK with garbage content — e.g., glm-5 returned just `"N" (1 token, finishReason: "unknown"`, 160s duration). Needs compound scoring heuristic + timing data threading through RAGResponse. ~4-6hr feature, not a quick win — moved details to Logging & Error Observability theme.

### ~~🏗️ `cpd:update-baseline` CLI helper~~ ✅ Done 2026-05-17 (PR #1043)

### ~~🏗️ Colocated test for `commands/cpd.ts` validation paths~~ ✅ Done 2026-05-17 (PR #1043 — 27 tests covering `assertThresholdInRange`, `parseBaseline`, `computeUpdatedBaseline`)

### ~~🏗️ Cache `process.cwd()` once in `filterReport`~~ ✅ Done 2026-05-17 (PR #1043)

### ~~🏗️ Better CI error message when `pnpm cpd` step crashed~~ ✅ Done 2026-05-17 (PR #1043)

### ~~🏗️ One-time lint-suppression audit~~ ✅ Done 2026-05-17

_Audit run: 97 suppressions across 5 packages, **0 unjustified**. The codebase already meets the project's "target 0" goal on this metric. No follow-up action needed. Top files: `bot-client/test/mocks/Discord.mock.ts` (9), `ai-worker/redis.ts` (4), `api-gateway/queue.ts` (3). All justifications scanned by `pnpm ops xray --suppressions` parse cleanly._

### ~~🏗️ One-time `pnpm knip` dead-code sweep~~ ✅ Done 2026-05-17, findings filed

_Audit run: `pnpm knip` is clean (no unused exports/imports/deps). `pnpm knip:dead` flagged 6 candidate dead files; all 6 verified as actually dead (only own test references each)._

**Findings (filed as new quick-win below):**

- `services/ai-worker/src/services/KeyValidationService.ts` — production validation moved to `api-gateway/src/utils/apiKeyValidation/*`; the service's own JSDoc claim "ai-worker ONLY" is stale
- `services/bot-client/src/memory/ConversationManager.ts`
- `services/bot-client/src/utils/api/gatewayFetcher.ts`
- `services/bot-client/src/utils/commandContext/testUtils.ts`
- `services/bot-client/src/utils/safeInteraction.ts`
- `services/bot-client/src/utils/triStateHelpers.ts`

### ~~🏗️ Dead-code removal: 6 files surfaced by `knip:dead` 2026-05-17~~ ✅ Done 2026-05-17 (PR #1044 — all 6 files + their tests removed after grep verification)
