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

### 🏗️ One-time lint-suppression audit

_Surfaced 2026-05-16 during campaign close-out planning. Different concern than the "graduate CPD warnings to errors" item in the Tooling & Quality Ratchet theme._

Run `pnpm ops xray --suppressions` once and audit findings. The project's `02-code-standards.md` rule says target 0 unjustified `eslint-disable` / `ts-expect-error` suppressions; the campaign added some new suppressions (e.g., in `configRouteHelpers.ts`) that should have justifications, plus there may be pre-existing unjustified ones from earlier work. Audit is ~30 min; addressing findings depends on count (could be quick-wins-sized or spawn a sub-task).

**Start**: `pnpm ops xray --suppressions | head -50` to see the output shape, then bucket findings.

### 🏗️ One-time `pnpm knip` dead-code sweep

_Surfaced 2026-05-16 during campaign close-out planning. Sibling to the suppression audit — different signal, same "run-the-audit-once" shape._

The Tooling & Quality Ratchet theme tracks "make Knip CI-blocking" as a future hardening step. **This entry is different**: just RUN it now to see what's currently dead. `pnpm knip` for live exports/imports; `pnpm knip:dead` for files only imported by their own tests. Both have been growing since the TTS epic. Audit, prune low-risk dead code, leave the rest for a focused PR.

**Start**: `pnpm knip` and `pnpm knip:dead` — read output, classify into safe-to-delete / needs-investigation / intentional-export.
