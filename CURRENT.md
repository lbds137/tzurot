# Current

> **Version**: v3.0.0-beta.206 — "forwards attributed everywhere, blurbs hardened, history as real messages": the forward batch (#2166–#2176: extended-context attribution, origin channel on quotes, own-footer stripping, forwarder access gating, embed binding, TASK-43 probe, reference-audio STT gate), blurb retry hardening + the release's one additive migration (#2177), doc-17 Phase 2 (#2179–#2186: `StructuredHistoryEntry` IR, realMessages render behind `realMessagesEnabled`, chunked eviction, header id tags, spoof neutralization, promptHash re-key — ships OFF in prod), riders #2187 (app-bot replies in extended context), #2188 (`/inspect` Messages view), #2189 (prefix-diff per-personality grouping), #2190 (TASK-739 default-persona cache eviction, prod-observed). 25 PRs / 23 runtime / 218 files. Premigrated to prod BEFORE the merge (owner ran the confirmation). Merged 2026-08-23 04:28 UTC via the documented FF path (rebase-merge choked mechanically on the large range; gate fired + satisfied first); finalize no-op; tagged + published; beta.205 demoted.
>
> **Previous**: v3.0.0-beta.205 — "Characters know who they're talking to" (roster + forwards + guest floor rescue). 30 PRs / 339 files. Merged 2026-08-20.

---

## 🚀 beta.206 SHIPPED (2026-08-23) — post-deploy checklist

Holistic release review: **no blocking findings** (verified 17-package bump lockstep, the migration's null-semantics comments + protected-index safety, both new flags default-OFF, notes-vs-diff mapping complete, TASK-739 cross-PR seam, the TASK-43 probe is the only TEMPORARY DIAGNOSTIC and is documented). Smoke ran pre-cut: 5/5 PASS + probe observation (evidence with requestIds in git history of this file, beta.206 section).

**Owner actions (owner-timed, in any order):**

- [x] **Prod flip: `rosterBlurbEnabled` ON** — FLIPPED (04:41:02 UTC) and **first enabled sweep VERIFIED** (04:48:27): `stamped=200 staleFound=10 generated=10 failedBilled=0 failedZeroSpend=0` — zero failures, backoff never fired; spend was 10 generations, not the whole roster. Rollback = flip OFF, live.
- [x] **Prod flip: `realMessagesEnabled` ON** — FLIPPED (04:41:32 UTC). First post-flip generation observed (04:55:57, cold channel): promptTokens=45.6k vs the same personality's pre-flip 32.6k — the expected budget-fill increase; cacheHitRatio=0 is correct for a first in-channel turn. **Cache reuse VERIFIED** (05:02:32, same channel turn 2, 285s gap): `cachedPromptTokens=23168` of 40.8k → **cacheHitRatio=0.57** (beats dev's turn-2 0.37), and `promptHashSystemCore` identical across the pair — the stable-prefix property holds in prod. Verification complete.
- [x] **`/persona default` confirmed working in prod** (owner, 2026-08-23) — the #2190 fix holds; the setting sticks. Known cosmetic bound: the autocomplete ⭐ badge lags up to ~60s behind a change (bot-client's autocomplete fresh-cache TTL, self-healing; the stale fallback only serves on gateway errors). Longer-than-a-minute lag would be a new finding.

**Watches (log-signal, no action needed):**

- Floor-promotion rescue (#2155/#2157, runtime-unverified): ai-worker line `No hop-1 retarget available — promoting the floor to the hop-1 target` on the next prod rate-limit window clears the now.md guest entry.
- GLM (b) (now.md entry): a retarget succeeding where a demoted turn previously dead-ended; hardening (b) gated on TASK-639.
- TASK-43 probe (`TASK-43 probe: forward mention sources`, bot-client): dev already answered it (`snapshot.mentions` populated); the fix PR removes the probe in a paired debug commit.

## ▶️ NEXT — beta.207 build queue

**beta.207 scope SETTLED (owner, 2026-08-23; plan in `backlog/now.md`).** Shipped already: hygiene batch #2192 (TASK-740/741/742 Done, 6 review rounds each catching a real gap incl. the set-default route itself and the users-table sync path) · mining/retrospective operationalization #2193 (TASK-732 Done — mode-table rewrite, spec-template hardening T1–T12, board-commit-branch-gate hook with 23 probe cases, memory promotions M1–M8 executed with deletions). TASK-685 Done (prod re-measure: 0/10 S1 cuts — TASK-651 closed). TASK-708 closed on its smoke evidence.

**Resume pointer — next build units:**

1. ~~TASK-745~~ SHIPPED #2194 (2026-08-23): current_location echo + prior_conversations scope="prior"/instruction + legacy memory-span strip; 4 review rounds, all findings dispositioned. ~~TASK-747~~ SHIPPED #2195 (2026-08-23): invokeModelGuarded (all 3 production invoke sites) + PROVIDER_CONTENT_REFUSED (advance-not-terminate, LONG TTL per model+attachment, pattern deliberately Alibaba-narrow); 4 rounds; TASK-749 filed (test-adapter consolidation).
2. ~~TASK-748~~ SHIPPED #2196 (2026-08-23, built inline): `sinkFreeRouteFallbacks` applied lazily after a failed primary, wallet probe gated on a mixed free/paid tail; 4 review rounds — lazy-probe restructure (r2), accepted-double-read pinned by wiring scenario 5 (r3), r4 clean. BYOK users now reach openrouter/auto before the free router.
3. **Wave 1 COMPLETE (2026-08-23 evening)**: ~~750~~ #2197 · ~~736~~ #2198 · ~~43~~ #2199 · ~~737~~ #2200 · ~~738~~ #2201. **Wave 2 COMPLETE (overnight into 2026-08-24) — beta.207 train FULL**: ~~639~~ closed zero-code (catalog fix had shipped in beta.205; prod retro-verified; GLM (b) unblocked) · ~~713~~ #2202 (reply-quote footer strip) · ~~754~~ #2203 (assistant-turn headers; kwargs-only ruling reversed; prod-misdating watch) · ~~616~~ #2204 (apply-after-deploy premigrate marker, 6 rounds) · **doc-12 P0.1** #2205 (command_events + privacy rider; dev migration APPLIED; four owner decisions locked in doc-12) · **doc-12 P0.2** #2206 (error-channel reporter; review caught + fixed a window-rollover High). Filed this session: 749 · 751 (owner) · 752 (usage skill) · 753 · 755 · 756 (board-gate bypass) · 757 (premigrate fail-open) · 758 (telemetry fidelity batch) · 759 (catch-surface inventory). Budget posture: Fable dispatch-only, ~450M in-equiv/week calibration in memory.

## 🧪 beta.207 SMOKE CHECKLIST (pre-cut; owner executes on dev)

All three need `FEEDBACK_CHANNEL_ID` set on dev bot-client for item 2-3; item 1 needs nothing. Everything is merged to develop and the dev migration is applied — dev auto-deploy carries the code.

- [x] **1. Telemetry row lands** — **PASS** (2026-08-24): owner's dashboard action wrote `preset.override.set` / outcome `ok` / 2249ms / guild at 05:07:33Z; verified by direct dev query, dotted name and latency correct.
- [ ] **2. Error embed posts** — **FAILED first attempt (2026-08-24), real gap found**: the forced model-not-found error via `&prefix` delivered as a completed job through `multiTagDeliveryFlow`, which never called `reportJobError` (reporter was only wired into MessageHandler's two handlers + slash path). Fix: PR #2207 (also covers `deliverErroredOutcomes` submit failures + `PersonalityMessageHandler` DM-session catch). **RETEST after #2207 merges and dev redeploys**: message the persona still on 'SMOKE broken model (delete me)' → expect one 🚨 embed, no message text.
- [ ] **3. Dedup suppresses** (needs-smoke: window logic under real timers): after item 2 retest posts an embed, repeat the SAME error within a few minutes → no second embed. Report: pass/fail is enough. **Cleanup after pass**: owner flips the persona back to a real model; agent deletes the 'SMOKE broken model (delete me)' llm_config row from dev (sync-tracked table — must not survive to ride a dev→prod sync).

Cut when: smoke passes + owner approves the release PR (always explicit). Prod migration is additive → standard `release:premigrate` order. Release notes: PR count grows by one with #2207 (re-derive via `release:range` at cut time — do not carry the 15/13/207 numbers forward). Follow-on filed from the smoke session: TASK-760 (invalid-model errors should retarget through the fallback cascade — owner suggestion).

**Response-length question ANSWERED (prod usage_logs, 2026-08-23)**: per-model output tokens collapsed ~5x during the beta.203/204 window (glm-5.2: 2455→~600–1000; glm-5.3 similar) and recovered to the pre-Aug-17 baseline the day beta.205 deployed — hypothesis (timing + the pinned GLM-5.3-fallback prod issue, not per-request-confirmed): z.ai served those requests via its fallback until #2153 routed to the real endpoint. NOT the real-messages flag (jump predates beta.206; Aug 23 below Aug 22). Watch item: glm-5.2's Aug-22 median was exactly 4000 — responses may be saturating a 4000 maxTokens cap; owner lever = per-persona maxTokens / brevity guidance, surfaced, no action taken.

**Qwen question ANSWERED (log sweep, 2026-08-23, six deployments Aug 14→23)**: qwen's `data_inspection_failed` refusals are a steady background rate going back to at least Aug 14 (19+20+4+4+5 hits per window, all on qwen/qwen3.7-plus) — always silently caught by openrouter/free or openrouter/auto while qwen described the large majority fine. Nothing changed on qwen's side; on Aug 23 both catch tiers failed at once (free 429 + our tier-3 TypeError = TASK-747), surfacing the refusal for the first time. Yesterday's diary photo was never vision-processed under beta.205 (verified against the deployment's full final-window logs) — both "days" of placeholders happened in today's single 14:12 request, re-attempted 14:39 (transient misclassification). Owner lever if first-try diary descriptions matter: per-personality `visionModel` on a non-Alibaba tier-1 — surfaced, owner's call, no action taken.

`ConversationHistoryEntry` (pipeline/types.ts) Pick/Omit fold still carried for whichever slice next touches the wire shape.

## 📋 Open items (near-term)

- **Purge remainder**: 1 reachable user awaits the warning DM — `retention:notify` NOT run (outward-facing; separate owner call).
- **Housekeeping**: `3f50da50.jsonl` (155MB, fully mined) is a disk-space deletion candidate — owner's explicit okay still needed.

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
