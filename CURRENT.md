# Current

> **Version**: v3.0.0-beta.203 — "z.ai thinking translation": doc-77 COMPLETE (z.ai `thinking`/`reasoning_effort` translation #2112, save-time validation #2114, GLM-5.3 catalog #2115, `show_thinking` retirement #2110) + riders (#2116 reference-stub preview, #2117 cache observability, #2118 guest-mode footer, #2119 persist durability, #2120 retention dev-footgun — the owner's pre-cut gate). 11 PRs / 9 runtime / 149 files. Migration (data-only JSONB strip) premigrated to prod BEFORE the merge (`release:premigrate --force`, owner-authorized via AskUserQuestion). Merged to main 2026-08-17 00:39 UTC; tagged + published; beta.202 demoted.

---

## 🚀 beta.203 SHIPPED (2026-08-16 EDT) — observability items, no smoke round

Release review clean (no blocking findings; it independently verified the migration's LWW-safety and the guest-mode/quota-fallback seam test). The two runtime-unverified paths are **observability-instead-of-smoke** by design:

- **Cache-observability fields (#2117)**: first prod generation proves them — check a `Generated response` log line for `secondsSinceLastChannelGeneration`, the three `promptHash*` fields, and `cacheHitRatio`.
- **Guest-mode footer (#2118)**: fires on the next real guest substitution; audit line `Guest-mode substitution applied` + footer "guest mode" category. **TASK-620 design stands as shipped** (single `guest_mode` category; owner sign-off was offered pre-release, silence = keep).
- z.ai thinking translation itself was owner-smoke-tested on dev pre-release (PR B, requestId `06dd8b51`) and probed live against GLM-5.3.

**Session process ledger (honest half)**: #2119 round 2 caught my round-1 fix being asymmetric (success-path persist isolated, error-path sibling missed — the two-way-sweep class); #2120 rounds 2–3 each caught a test-hygiene gap in my own additions (console-spy convention; `mockNodeEnv` describe relying on a sibling's reset). All applied same-round. Near-miss: a `git checkout <file>` on uncommitted work was hook-blocked (cwd-drift guard) — restored via Edit instead.

## 📋 Open items (near-term)

- **S1 (beta.201, #2090 export-clear round-trip) — STILL OPEN**: export a character with an **empty** field → re-import → confirm it stays empty. The one silent-failure flow in that range. TASK-590 (`customFields` lossy gateway-side) is the known gap left out on purpose.
- **beta.203 vNext theme pick (owner)**: doc-17 §2.5 chunked-eviction hysteresis is the strong candidate (~14-19k tokens/turn; measurement in tracker doc-17 reframed the caching model — chat_log's prefix dies EVERY turn under the 50-cap slide). TASK-622 (roster active-flag volatility) pairs with it. Drain campaign resumes as background either way.
- **doc-17 open question**: incident request's `cachedPromptTokens: 0` — the #2108 smoke's warm-generation 79% hit reframes it as likely cold/TTL; TTL-bracket probe noted in the doc.

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

_This session spanned beta.203's full cycle plus multiple compactions; a fresh session is a clean continuation point whenever convenient — owner's call._
