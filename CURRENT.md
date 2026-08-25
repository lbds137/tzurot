# Current

> **Version**: v3.0.0-beta.207 — "observability + invalidation hygiene": doc-12 P0 (command telemetry #2205 + error-channel reporter #2206, hardened by smoke-found #2207), boot watchdog #2211 (born from the same-day 85-min silent boot hang), MUTE-denial silence #2212 (live-found during owner moderation), the hygiene batch #2192, real-messages fixes (#2194/#2202/#2203), vision cost guards (#2196/#2200), premigrate marker #2204, riders #2195/#2197/#2198/#2199/#2201. 18 PRs / 16 runtime / 245 files (release range 228 + version bump). Premigrated (`add_command_events`, additive) BEFORE the merge; merged 2026-08-24 17:34 UTC; finalize SHA-aligned develop; tagged + released. Holistic review: no blocking findings. Prod deploy verified: bot-client SUCCESS + clean login 17:35Z.
>
> **Previous**: v3.0.0-beta.206 — "forwards attributed everywhere, blurbs hardened, history as real messages" (25 PRs / 218 files, 2026-08-23). Both prod flags (rosterBlurb, realMessages) flipped ON and verified.

---

## 🚀 beta.207 SHIPPED (2026-08-24) — post-deploy state

Smoke ran pre-cut on dev: 3/3 PASS (telemetry row · error embed with no message text · dedup suppression) — item 2's first attempt FOUND the multi-tag reporter bypass, fixed as #2207. Smoke config deleted from dev post-pass.

**Owner actions — ALL CLOSED (2026-08-24 evening):**

- [x] **COLD's model override** — owner: COLD never had an override; the default cascade IS its correct state. No action.
- [x] **Railway restart policy** — owner confirmed via dashboard: On Failure, 10 retries (screenshot 2026-08-24 22:18).
- [x] **Dependabot trio RESOLVED** (owner: "include them + do any main cut necessary"): #2209 (7 prod deps) + #2216 (20 dev deps, the recreated #2210) merged to develop; the claude-code-action bump landed via TWO main-cut PRs (#2215 → 1.0.199, #2217 → 1.0.200 — upstream released mid-pass) with `release:finalize` after each; #2208/#2210 closed by dependabot as satisfied/superseded. Zero open dependabot PRs. Sequencing lesson recorded: finalize's develop force-push re-strands open dependabot branches, so develop-bound merges go FIRST, main-cut + finalize LAST (third strand needed `@dependabot recreate`).

**Watches (log/data-signal, no action):**

- `command_events` accumulating in PROD (first organic rows; P1.1 report SQL is the consumer).
- Error channel: first prod posts should be real system errors only (deny-listed categories stay out); category-only dedup fan-in is the TASK-759 design member.
- Boot watchdog live in prod — a `Boot deadline exceeded` line = it worked (runbook: RAILWAY_OPERATIONS.md § bot-client).
- TASK-754 carry: owner-observed misdating should stop under assistant-turn headers.
- Nightly dev↔prod sync self-heals tonight (schema skew resolved by the premigration).

## 🔍 2026-08-24 mining run: delegation posture SHIPPED (PR #2214, post-beta.207)

Fable-usage lens over the beta.207 window (owner ask: "dial back Fable"). Measured: 71/29 main-loop/delegated out-token split, ~70% of tool-attached spend mechanically delegable; root cause = the dispatch-only posture lived only in non-loading surfaces (memory + a skill invoked 2× in 32h). Shipped (all owner-approved): § Delegation posture in always-loaded `10-working-posture.md` · orchestration mid-review inline carve-out RETIRED + review-response § 3a (round fixes = one dispatch) · `dispatch-posture-gate.sh` (first src edit per branch/day blocks once; worktree workers exempt) · `python-heredoc-edit-guard.sh` (interpreter rewrite-scripts → Edit tool; `TZUROT_ALLOW_HEREDOC_EDIT=1` override) · `/tzurot-usage-audit` skill (TASK-752 Done; ledger is machine-local). 4 review rounds, batch-dispositioned; residue = task-769. Bash-side hook LIVE-VERIFIED in-session (fired twice, including on the agent's own heredoc habit).

**Next-session check**: the `Edit|Write|MultiEdit` matcher gets its first live test (hook config loads at session start) — first main-tree src edit should print the DISPATCH POSTURE banner once; if it never fires, the matcher alternation is the suspect (fail-open). Next mining delta starts at this session (08a1ee8b, from 2026-08-24 ~20:30Z); first re-test targets: hooks firing + delegation ratio moving off 71/29.

## ▶️ NEXT — beta.208 queue (plan in `backlog/now.md` § 🚢)

High-priority carried: **TASK-766** (MUTE slash-path leak, high — ship-and-file residual from #2212 review) · TASK-763 (transcript-reply retarget) · TASK-760 (invalid-model fallback cascade, owner-suggested) · TASK-761 (legacy job-failure path) · TASK-764/765 (deny UX + thread denials). Cycle openers: the dependabot trio. Theme pick = owner call (council queue: doc-64/65/66/67/70/71/72; or doc-12 P1).

**Response-length question ANSWERED (prod usage_logs, 2026-08-23)**: per-model output tokens collapsed ~5x during the beta.203/204 window and recovered the day beta.205 deployed — hypothesis (timing + the pinned GLM-5.3-fallback prod issue, not per-request-confirmed): z.ai fallback until #2153. Watch item: glm-5.2's Aug-22 median was exactly 4000 — may be saturating a 4000 maxTokens cap; owner lever = per-persona maxTokens, surfaced, no action taken.

**Qwen question ANSWERED (log sweep, 2026-08-23)**: `data_inspection_failed` is a steady background rate (≥Aug 14), normally caught silently by the fallback tiers; surfaced only when both tiers failed at once (TASK-747, fixed). Owner lever if first-try diary descriptions matter: per-personality `visionModel` on a non-Alibaba tier-1 — surfaced, owner's call.

`ConversationHistoryEntry` (pipeline/types.ts) Pick/Omit fold still carried for whichever slice next touches the wire shape.

## 📋 Open items (near-term)

- **Purge remainder**: 1 reachable user awaits the warning DM — `retention:notify` NOT run (outward-facing; separate owner call).
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
