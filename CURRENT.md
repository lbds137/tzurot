# Current

> **Version**: v3.0.0-beta.203 — "z.ai thinking translation": doc-77 COMPLETE (z.ai `thinking`/`reasoning_effort` translation #2112, save-time validation #2114, GLM-5.3 catalog #2115, `show_thinking` retirement #2110) + riders (#2116 reference-stub preview, #2117 cache observability, #2118 guest-mode footer, #2119 persist durability, #2120 retention dev-footgun — the owner's pre-cut gate). 11 PRs / 9 runtime / 149 files. Migration (data-only JSONB strip) premigrated to prod BEFORE the merge (`release:premigrate --force`, owner-authorized via AskUserQuestion). Merged to main 2026-08-17 00:39 UTC; tagged + published; beta.202 demoted.

---

## 🚀 beta.203 SHIPPED (2026-08-16 EDT) — observability items, no smoke round

Release review clean (no blocking findings; it independently verified the migration's LWW-safety and the guest-mode/quota-fallback seam test). The two runtime-unverified paths are **observability-instead-of-smoke** by design:

- **Cache-observability fields (#2117): ✅ VERIFIED LIVE** (prod logs 2026-08-17 01:07–01:57 UTC — `cacheHitRatio=0.62`, all three `promptHash*` fields, `secondsSinceLastChannelGeneration` present on real generations).
- **Guest-mode footer (#2118): ✅ VERIFIED LIVE** (multiple `Guest-mode substitution applied` audit lines in the same window; owner screenshot shows the footer's "(guest mode)" category rendering). **TASK-620 design stands as shipped.**
- z.ai thinking translation itself was owner-smoke-tested on dev pre-release (PR B, requestId `06dd8b51`) and probed live against GLM-5.3.

**Session process ledger (honest half)**: #2119 round 2 caught my round-1 fix being asymmetric (success-path persist isolated, error-path sibling missed — the two-way-sweep class); #2120 rounds 2–3 each caught a test-hygiene gap in my own additions (console-spy convention; `mockNodeEnv` describe relying on a sibling's reset). All applied same-round. Near-miss: a `git checkout <file>` on uncommitted work was hook-blocked (cwd-drift guard) — restored via Edit instead.

## ✅ 2026-08-16 late session: beta.204 design ACCEPTED + mining pass + handoff prep

- **beta.204 theme CONFIRMED + design ACCEPTED** (owner pass, same evening): count-cap hysteresis — [`prompt-assembly-architecture.md` §2.5.2](docs/proposals/backlog/prompt-assembly-architecture.md) (quad council record §9b). Build slices, Opus-executable: **PR 0** z.ai TTL/discount probe (also attributes the `cachedPromptTokens: 0` mystery) → **PR 1** TASK-622 roster fix (both halves decided, state:ready) → **PR 2** ConversationHistoryService windowed fetch (one repeatable-read tx, 25% chunk, 20-msg floor, telemetry meta, EXPLAIN-decided index).
- **Mining run 2026-08-16 complete** (window 08-12→08-17): all five dispositions landed — P1/P3/P5 in **PR #2122 (in flight at write time)**, P2 = TASK-637, P4 answered: **the ~6-round review cap is SOFT, severity-gated** (hard for polish; High-severity correctness/security always gets its round) — recorded in the orchestrator memory.
- **Deploy-orphan Production Issue CLOSED** — release-verified live during the beta.203 deploy (owner witnessed the delayed real reply; `Job stalled` trail confirmed in prod logs; commit `447909122`).
- TASK-636 filed (model-footer dedupe, owner-proposed shape — beta.204 rider candidate).

## 📋 Open items (near-term)

- **Purge EXECUTED (owner-authorized 2026-08-16)**: 20 never-used accounts erased (cohort had grown 18→20 by run time), 0 characters touched, post-run preview confirms 0 eligible, userbase 228→208. Tombstones propagate to dev on next sync (the #2120-safe direction). Remaining: 1 reachable user awaits the warning DM — `retention:notify` NOT run (outward-facing; separate owner call).
- **S1 (beta.201, #2090 export-clear round-trip) — STILL OPEN**: export a character with an **empty** field → re-import → confirm it stays empty. TASK-590 (`customFields` lossy gateway-side) is the known gap left out on purpose.
- **Housekeeping**: `3f50da50.jsonl` (155MB, fully mined) is a disk-space deletion candidate — owner's explicit okay still needed.

## 🔧 DRAIN CAMPAIGN — resumes now (doc-77 shipped); batching is the method

Backlog composition, measured: ~321 open = 107 `ready` · 97 `observable` · 57 `dependent` · 45 `owner` — only ~1/3 agent-drainable; filing rate (not staleness, measured ~3%) drives growth. **Themed batches over per-task PRs** (4-5 closes per cycle vs 1). Pre-grounded: 199+200 together (bare-run HEALTH_TOOLS shape); 349 and 457 solo (457 has a global-flag design call); held for owner: 527 (copy), 540 (HTTP contract), 559 (pick), 531 (process design); TASK-599 = the batched owner-decision pass over `state:owner`. Query, do not browse: `pnpm tracker task list -s "To Do" -l state:ready -l size:S --plain` (the `-s "To Do"` is load-bearing).

**Carry-forwards (all one shape — a check that can't distinguish measured-fine from didn't-measure)**: publish the command, never the hand-restated number; negative-control a FIX by running it; a probe that swallows stderr certifies broken code green (check other probes for `2>/dev/null` in invoke paths).

**Open rule-shaped gap, not yet drafted**: five of #2097's last six defects entered _while fixing a previous finding_ — every countermeasure fires at authoring time, none at correction time. This session added data: #2119 round-2 (asymmetric fix) and #2105's round-4 regression are the same class. Wants a council pass (TASK-531 adjacent).

## 🧵 Standing threads (durable)

- **Voice-consistency harness BUILT (#1910/#1911); remaining: the owner's ~15-min sitting** — blind-review `reports/voice-consistency/judgment-sheet.md` → `pnpm eval:voice-verdict`. Judge preview: A-vs-B 5/5/8, B-vs-B′ control 8/18 (the pre-registered under-power flag may trip — read the noise-floor line before trusting a PASS). Artifacts backed up (`voice-consistency-2026-08-04.tar.gz`). **Owner's leisure — do not re-surface as a recommendation.** Phase 2 (history extraction) + the #1317 cluster + TASK-165 stay gated behind it.
- **Opus trial record**: TASK-513 (owner decision surface) + TASK-487 (Sonnet-tier evidence ledger). Orchestrator failure shape: a check that inherits the assumption it tests → canary, Core Principle 9.
- Owner-idea council queue: doc-64 (meta-harness spinoff; license recorded), doc-65 (private brain), doc-66 (message coalescing), doc-67 (tag-scoped sharing), doc-70/71/72 (tag mgmt/dashboard nav).
- Waffles' venue-leak report: awaiting their Share Memories answer (doc-8 carries the design input either way).
- TASK-514 (mis-channel WARN watch) · TASK-425/426/410 (beta.191 threads; bullmq/ioredis v6 pending, dependabot-ignored until then) · 55 doubled-transcript rows age out ~Sep 2 · doc-59 (BYOK video).
- **Owner decisions locked** (still governing): no asset table for attachments · descriptions live 30d keyed to `DAYS_TO_KEEP_HISTORY` · direct replies always re-vision · extended context re-visions only within retention · undescribed old images render a presence note · extended-context quota exemption AFTER persistence · `maxImages` is a spend cap · moderator cascade (TASK-529) + shared-persona-name collision (TASK-528, key by personaId) fix shapes recorded.
- **Retention is calendar-only**: books as of 2026-08-09 — 221+ users, 5 in earlier grace (~08-26 expiries) + 2 warned (~09-08). Phase 4 autonomy parked BY DESIGN. Dev nag now silenced by #2120's prod gate.

_HANDOFF READY (2026-08-16 late): the next session runs **Opus 5 orchestrator** per the standing default. First units: merge/absorb PR #2122 if still open → beta.204 PR 0 (probe) → PR 1 (TASK-622) → PR 2 (windowed fetch), drain batches as riders. The design is settled — workers build to §2.5.2's spec; escalate only owner-taste/schema calls. Review cap: soft, severity-gated (see orchestrator memory)._
