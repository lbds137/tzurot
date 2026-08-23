# Current

> **Version**: v3.0.0-beta.206 — "forwards attributed everywhere, blurbs hardened, history as real messages": the forward batch (#2166–#2176: extended-context attribution, origin channel on quotes, own-footer stripping, forwarder access gating, embed binding, TASK-43 probe, reference-audio STT gate), blurb retry hardening + the release's one additive migration (#2177), doc-17 Phase 2 (#2179–#2186: `StructuredHistoryEntry` IR, realMessages render behind `realMessagesEnabled`, chunked eviction, header id tags, spoof neutralization, promptHash re-key — ships OFF in prod), riders #2187 (app-bot replies in extended context), #2188 (`/inspect` Messages view), #2189 (prefix-diff per-personality grouping), #2190 (TASK-739 default-persona cache eviction, prod-observed). 25 PRs / 23 runtime / 218 files. Premigrated to prod BEFORE the merge (owner ran the confirmation). Merged 2026-08-23 04:28 UTC via the documented FF path (rebase-merge choked mechanically on the large range; gate fired + satisfied first); finalize no-op; tagged + published; beta.205 demoted.
>
> **Previous**: v3.0.0-beta.205 — "Characters know who they're talking to" (roster + forwards + guest floor rescue). 30 PRs / 339 files. Merged 2026-08-20.

---

## 🚀 beta.206 SHIPPED (2026-08-23) — post-deploy checklist

Holistic release review: **no blocking findings** (verified 17-package bump lockstep, the migration's null-semantics comments + protected-index safety, both new flags default-OFF, notes-vs-diff mapping complete, TASK-739 cross-PR seam, the TASK-43 probe is the only TEMPORARY DIAGNOSTIC and is documented). Smoke ran pre-cut: 5/5 PASS + probe observation (evidence with requestIds in git history of this file, beta.206 section).

**Owner actions (owner-timed, in any order):**

- [ ] **Prod flip: `rosterBlurbEnabled` ON** (`/admin settings` → Operations) — corpus-wide spend event (first sweep generates blurbs for the whole prod roster). Dev's first live run: `stamped=200 staleFound=10 generated=10 failedBilled=0 failedZeroSpend=0`, backoff never fired. Rollback = flip OFF, live.
- [ ] **Prod flip: `realMessagesEnabled` ON** (`/admin settings` → Operations) — history ships as real user/assistant messages. Dev verification: flag-on prefix pairs IDENTICAL (full prefix reuse), system prompt 58k → 24.5k chars, cache ratio 0.02 → 0.37 by turn 2. **Watch at flip: promptTokens** (dev went 15.9k → 35.4k — expected PR 2.4 budget-fill, but confirm prod cost is acceptable). Say when flipped — the log-side checks (per-stream prefix-diff, stable-prefix diagnostic, cache ratio) run from here.
- [ ] **Confirm `/persona default` shows the default you want** (prod) — the TASK-739 stale-cache window left the DB on the wrong persona during the repro (2026-08-23 03:17 UTC); the cache TTL has long expired and #2190 is now deployed, so one re-run of the command sticks correctly.

**Watches (log-signal, no action needed):**

- Floor-promotion rescue (#2155/#2157, runtime-unverified): ai-worker line `No hop-1 retarget available — promoting the floor to the hop-1 target` on the next prod rate-limit window clears the now.md guest entry.
- GLM (b) (now.md entry): a retarget succeeding where a demoted turn previously dead-ended; hardening (b) gated on TASK-639.
- TASK-43 probe (`TASK-43 probe: forward mention sources`, bot-client): dev already answered it (`snapshot.mentions` populated); the fix PR removes the probe in a paired debug commit.

## ▶️ NEXT — beta.207 planning + the next-train queue

**vNext theme (per the beta.206 plan's sketch): doc-12 observability** — the "incidents reach the owner before the tooling" layer; the realMessages flip's cache-cost read (TASK-685) feeds it. Starts with a scoping pass over doc-12.

**Next-train small queue (all tracker-filed, `state:ready` unless noted):** TASK-43 fix (resolve forwarded mentions via `snapshot.mentions.users`; removes the probe) · TASK-740 (persona invalidation channel has no publisher + fragmented resolver instances; includes the #2190-review AccountEraser unification member) · TASK-741 (activation invalidation publishes from the caller, not the writer) · TASK-742 (db-sync bulk user writes skip cache invalidation) · TASK-736 (reasoning view fence-neutralizer class member) · TASK-737 (vision media_not_found on expired CDN URLs) · TASK-738 (Messages view boundary cosmetics, low) · TASK-732 (orchestration retrospective — owns the skill-table update for the 2026-08-22 dispatch-mode reversal) · TASK-730 (`/inspect` redaction — owner call).

`ConversationHistoryEntry` (pipeline/types.ts) Pick/Omit fold still carried for whichever slice next touches the wire shape.

## 📋 Open items (near-term)

- **Purge remainder**: 1 reachable user awaits the warning DM — `retention:notify` NOT run (outward-facing; separate owner call).
- **Housekeeping**: `3f50da50.jsonl` (155MB, fully mined) is a disk-space deletion candidate — owner's explicit okay still needed.

## 🔧 DRAIN CAMPAIGN — standing; batching is the method

Backlog composition, measured: ~321 open = 107 `ready` · 97 `observable` · 57 `dependent` · 45 `owner` — only ~1/3 agent-drainable; filing rate (not staleness, measured ~3%) drives growth. **Themed batches over per-task PRs** (4-5 closes per cycle vs 1). Pre-grounded: 199+200 together (bare-run HEALTH_TOOLS shape); 349 and 457 solo (457 has a global-flag design call); held for owner: 527 (copy), 540 (HTTP contract), 559 (pick), 531 (process design); TASK-599 = the batched owner-decision pass over `state:owner`. Query, do not browse: `pnpm tracker task list -s "To Do" -l state:ready -l size:S --plain` (the `-s "To Do"` is load-bearing).

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
