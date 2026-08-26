# Current

> **Version**: v3.0.0-beta.208 — "telemetry consumers + carried fixes": doc-12 FULL P1 tier (#2222 telemetry:report · #2223 usage attribution + telemetry:inference + privacy rider · #2224 weekly export-path smoke) + four carried fixes (#2218 MUTE denial copy · #2219 transcript-reply retarget · #2220 invalid-model classify/veto/rescue-reporting · #2221 hard-failure delivery) + dependabot deps (#2209/#2216) + mining operationalization (#2214). 10 PRs / 8 runtime / 137 files. TWO additive migrations premigrated BEFORE the merge (`add_usage_attribution`, `add_usage_personality_index`). Merged 2026-08-26 00:35 UTC; finalize SHA-aligned develop; tagged + published (latest). Holistic review: no blocking findings (dug the byok×quota-fallback seam independently). Prod deploy: new-build verification via the export-smoke scheduler boot line — see watches.
>
> **Previous**: v3.0.0-beta.207 — "observability + invalidation hygiene" (18 PRs / 16 runtime / 245 files, 2026-08-24). doc-12 P0: command telemetry + error-channel reporter + boot watchdog.

---

## 🚀 beta.208 SHIPPED (2026-08-26) — post-deploy state

Full session arc 2026-08-25→26: four carried fixes → owner picked doc-12 P1 and expanded to the full tier → P1.1/P1.2/P1.3 shipped → cut approved → premigrated → merged 00:35Z → finalized → published. **Prod new-build verified live 00:35:38Z** (shard ready + `export-smoke` scheduler registered — the new code's own boot line). All nested-dispatch; review process caught two Mediums + one HIGH across the feature PRs (byok-stale-across-retarget, sentinel-scoping oracle, zero-count blind spot) — all fixed pre-merge.

**Watches (log/data-signal, no action):**

- **First prod export-smoke run: PASSED 00:36:58Z** (`Export-path smoke passed`, 80s after boot) — the real export pipeline validated end-to-end in prod on first fire. Weekly cadence after; silent = pass, 🧯 owner embed = failure.
- `usage_logs` attribution columns (`latency_ms`/`byok`/`personality_id`) now populating in prod — `pnpm ops telemetry:inference --env prod` becomes meaningful after ~a day of rows; discoverability report likewise accumulating (`telemetry:report`).
- `model_not_found (rescued)` ⚠️ embeds = a delisted-model persona self-healing (GLM now.md entry clears on first observation).
- Error channel: first prod posts should be real system errors only; TASK-754 misdating stop; boot-watchdog standing.
- Carried question watches: glm-5.2 median-4000 maxTokens saturation (owner lever: per-persona maxTokens); Qwen `data_inspection_failed` background rate (owner lever: per-personality visionModel).

**Mining posture (carry)**: delegation posture + gates shipped in #2214 and live-verified both sides; next mining delta starts at session 08a1ee8b (2026-08-24 ~20:30Z); re-test target: delegation ratio off 71/29. This release cycle ran fully on the new posture.

`ConversationHistoryEntry` (pipeline/types.ts) Pick/Omit fold still carried for whichever slice next touches the wire shape.

## 📋 Open items (near-term)

- **Usage posture (through the Sun 02:00 ET reset)**: Fable meter over trajectory at the 2026-08-25 21:02 reading (53% vs ~37% pro-rata; all-models 41%) → **the Opus-driver backup lane is the standing driver for routine work this week**; Fable reserved for beta.209 design/verification passes. Durable operationalization SHIPPED in #2226 (flip trigger = `/tzurot-usage-audit` § Step 4a, batching/compaction economics in `10-working-posture.md`).

- **Retention: FULLY caught up 2026-08-26** (owner-approved): 11 never-used accounts purged, then the last pending warning DM **bounced** (DMs closed / left every shared server) → that user flipped to unreachable and was purged too. Userbase 212 → 200; 0 eligible, 0 awaiting DM, 7 in grace (~09-08 expiries are the next retention event).
- **Housekeeping**: BOTH large session JSONLs are now fully mined and are disk-space deletion candidates — `015f3cbc` (152MB, mined through 2026-08-17) and `0059bca0` (147MB, session ended 2026-08-24, mined to end). Owner's explicit okay still needed. (The previously-listed `3f50da50.jsonl` was already deleted 2026-08-16.)

## 🔧 DRAIN CAMPAIGN — standing; batching is the method

Backlog composition: ~393 open per the 2026-08-23 digest (state split last measured at the ~321 mark: 107 `ready` · 97 `observable` · 57 `dependent` · 45 `owner` — only ~1/3 agent-drainable); filing rate (not staleness, measured ~3%) drives growth. **Themed batches over per-task PRs** (4-5 closes per cycle vs 1). Pre-grounded remainder: 199 solo (bare-run HEALTH_TOOLS shape; its batch-mates 200/349/457 shipped — verified Done in tracker 2026-08-23); held for owner: 527 (copy), 540 (HTTP contract), 559 (pick), 531 (process design); TASK-599 = the batched owner-decision pass over `state:owner`. Query, do not browse: `pnpm tracker task list -s "To Do" -l state:ready -l size:S --plain` (the `-s "To Do"` is load-bearing).

**Carry-forwards (all one shape — a check that can't distinguish measured-fine from didn't-measure)**: publish the command, never the hand-restated number; negative-control a FIX by running it; a probe that swallows stderr certifies broken code green (check other probes for `2>/dev/null` in invoke paths).

**Open rule-shaped gap, not yet drafted**: five of #2097's last six defects entered _while fixing a previous finding_ — every countermeasure fires at authoring time, none at correction time. Wants a council pass (TASK-531 adjacent).

## 🧵 Standing threads (durable)

- **Voice-consistency harness BUILT (#1910/#1911); remaining: the owner's ~15-min sitting** — blind-review `reports/voice-consistency/judgment-sheet.md` → `pnpm eval:voice-verdict`. Judge preview: A-vs-B 5/5/8, B-vs-B′ control 8/18 (the pre-registered under-power flag may trip — read the noise-floor line before trusting a PASS). Artifacts backed up (`voice-consistency-2026-08-04.tar.gz`). **Owner's leisure — do not re-surface as a recommendation.** The #1317 cluster + TASK-165 stay gated behind it.
- **Opus trial record**: TASK-513 (owner decision surface) + TASK-487 (Sonnet-tier evidence ledger). Orchestrator failure shape: a check that inherits the assumption it tests → canary, Core Principle 9.
- Owner-idea council queue: doc-64 (meta-harness spinoff; license recorded), doc-65 (private brain), doc-66 (message coalescing), doc-67 (tag-scoped sharing), doc-70/71/72 (tag mgmt/dashboard nav).
- Waffles' venue-leak report: awaiting their Share Memories answer (doc-8 carries the design input either way).
- TASK-514 (mis-channel WARN watch) · TASK-425/426/410 (beta.191 threads; bullmq/ioredis v6 pending, dependabot-ignored until then) · 55 doubled-transcript rows age out ~Sep 2 · doc-59 (BYOK video).
- **Owner decisions locked** (still governing): no asset table for attachments · descriptions live 30d keyed to `DAYS_TO_KEEP_HISTORY` · direct replies always re-vision · extended context re-visions only within retention · undescribed old images render a presence note · extended-context quota exemption AFTER persistence · `maxImages` is a spend cap · moderator cascade (TASK-529) + shared-persona-name collision (TASK-528, key by personaId) fix shapes recorded.
- **Retention is calendar-only**: books as of 2026-08-09 — 221+ users, 5 in earlier grace (~08-26 expiries) + 2 warned (~09-08). Phase 4 autonomy parked BY DESIGN. Dev nag now silenced by #2120's prod gate.
- **doc-78 — DM Context Isolation: DESIGN SETTLED + GROUNDED** (enum `shareHistoryAcrossPersonalities`, default `always`; no migration). Full design + 7 registration sites + runtime evidence in tracker doc-78.
- **TASK-671 — memory recirculates stale facts**: step 0 is one string (`MEMORY_ARCHIVE_INSTRUCTION` never mentions time — owner's catch); a concrete argument on doc-8's FOR side.
