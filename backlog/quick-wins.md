## ⚡️ Quick Wins

_Small tasks that can be done between major features. Good for momentum._

### 🐛 Detect and Retry Inadequate LLM Responses

LLMs occasionally return a 200 OK with garbage content — e.g., glm-5 returned just `"N" (1 token, finishReason: "unknown"`, 160s duration). Needs compound scoring heuristic + timing data threading through RAGResponse. ~4-6hr feature, not a quick win — moved details to Logging & Error Observability theme.

### 🏗️ `cpd:update-baseline` CLI helper

_Surfaced 2026-05-16 from PR #1042 round-7 review. Out-of-scope of the campaign-close PR; tracked here as a quick follow-up._

Currently when the ratchet legitimately needs to be updated (e.g., after a planned helper extraction that lowers `filteredLines`), the workflow is "manually edit `.github/baselines/cpd-baseline.json`." A `pnpm ops cpd:update-baseline` command that runs `pnpm cpd` + the post-filter, writes the new `filteredLines` value (+ optional new `graceMargin`), and prints a summary diff would close the UX gap. ~30 LOC in `packages/tooling/src/commands/cpd.ts` reusing the existing filter logic.

**Start**: `packages/tooling/src/commands/cpd.ts` (alongside the existing `cpd:filtered` and `cpd:check` commands).

### 🏗️ Colocated test for `commands/cpd.ts` validation paths

_Surfaced 2026-05-16 from PR #1042 review rounds (raised in rounds 1, 3, 4, 6, 7 — consistently flagged but declined per scope)._

`commands/cpd.ts` contains real validation logic: `parseBaseline` (JSON parse + type checks + `process.exit(1)` paths) and `assertThresholdInRange` (range guard). Currently no colocated test file. Reviewer's framing: `parseBaseline` is substantive enough that its error paths (malformed JSON, missing `filteredLines`, out-of-range threshold) deserve direct unit tests analogous to the `loadJscpdReport` suite. Consistent with the project's structure-test colocation pattern.

**Start**: `packages/tooling/src/commands/cpd.test.ts` (new file). Pattern reference: `packages/tooling/src/cpd/postFilter.test.ts` (already has the malformed-JSON / missing-field test shape).

### 🏗️ Cache `process.cwd()` once in `filterReport`

_Surfaced 2026-05-16 from PR #1042 round-8 review. Micro-optimization; reviewer noted "negligible for tooling" but easy fix._

`relativeName` calls `process.cwd()` inside the duplicate-iteration loop in `filterReport`. Each call is a syscall. Cache once before the loop, pass to a renamed `stripCwd(absPath, cwd)` helper.

**Start**: `packages/tooling/src/cpd/postFilter.ts` `filterReport` function.

### 🏗️ Better CI error message when `pnpm cpd` step crashed

_Surfaced 2026-05-16 from PR #1042 round-8 review._

If `pnpm cpd` crashes before emitting `reports/jscpd/jscpd-report.json` (jscpd schema drift, OOM, etc.), the next CI step (`pnpm ops cpd:check`) fails with "jscpd report not found" — accurate but confusing when the log shows `pnpm cpd` just ran (and was marked successful due to `continue-on-error: true`). Add a hint to the error message pointing at the preceding step.

**Start**: `packages/tooling/src/commands/cpd.ts` — both the `cpd:filtered` and `cpd:check` actions have the same `jscpd report not found` early-exit.

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

### 🏗️ Dead-code removal: 6 files surfaced by `knip:dead` 2026-05-17

_Surfaced 2026-05-17 by the dead-code audit (above). All 6 verified — each has only its own `.test.ts` as a reference, no production imports. Some may have intended consumers that were removed in earlier refactors but the helper + tests stayed._

**Files to remove (with their `.test.ts` siblings):**

1. `services/ai-worker/src/services/KeyValidationService.ts` (+ test) — production validation lives in `api-gateway/src/utils/apiKeyValidation/{elevenlabs,mistral,openrouter,zaiCoding}.ts`. The ai-worker JSDoc comment claiming "ai-worker ONLY" was misleading even when written.
2. `services/bot-client/src/memory/ConversationManager.ts` (+ test) — verify against any vestigial memory-system code paths
3. `services/bot-client/src/utils/api/gatewayFetcher.ts` (+ test) — possibly superseded by `callGatewayApi` / `adminFetch` helpers
4. `services/bot-client/src/utils/commandContext/testUtils.ts` (+ test) — test-helper for something that no longer exists
5. `services/bot-client/src/utils/safeInteraction.ts` (+ test) — possibly superseded by the current interaction-handling patterns
6. `services/bot-client/src/utils/triStateHelpers.ts` (+ test) — verify against settings cascade code (tri-state semantics could come back if needed)

**Approach**: one small PR removing all 6 + their tests. Pre-check each via git log (when was it last meaningfully used?) and a final grep across `services/` for any string references missed by the basename-only matcher (knip:dead's documented limitation). Likely 1-2 hours including verification.

**Why not delete in audit session**: each removal needs the verification pass per file. Lumping audit + removal would have been a 4-5 hour session; splitting keeps the audit findings fast and the removal focused.
