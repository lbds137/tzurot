# Current

> **Version**: v3.0.0-beta.212 — "Parent Value fix + link-preview provenance + mutation-floor campaign + deps" (10 PRs / 8 runtime / 120 range files, no migrations, merged 2026-08-31 ~19:20Z; finalize done, tagged `latest`). Constituent detail: git + release notes.
>
> **Previous**: v3.0.0-beta.211 — "deny surface completion + model-footer clarity + restart delivery recovery" (13 PRs / 10 runtime, 2026-08-31 01:58Z).

---

## 🌙 2026-09-01 (evening) — beta.213 units + context-cost pass (Fable-driven after a surprise usage reset)

**Merged**: **#2289** TASK-847+846 (single-flight subscribe + error listener; five rounds — round 2 found a third shutdown race, round 4 moved the listener before the handshake; residue TASK-858) · **#2290** rules economy pass (owner call: trim before the drain batches; −10.3k bytes, five rounds restored ~1.3k of over-cuts). **#2291** Batch 1 hooks (four rounds; each of the first three closed a real hole in the new tracker-write guard — quoted wrappers, `cd`-fallthrough ordering, escaped separators — the probe suite grew 38 → 52). **#2292** Batch 2 tooling/release (four rounds; the dev gate grew an unreachable-vs-behind split including the rejected-promise path, then a per-call timeout on the shared Railway runner). **#2293** floors banked (identity 78.97 → 95.51, cache-invalidation → 97.68; the first measurement run was stopped mid-way by something outside this session and resumed on the owner's call). **Slate complete — cut prep next.** **Archived**: TASK-699 (duplicate of 818), TASK-595 (option (b) had shipped under TASK-459 before it was filed; prose remainder → TASK-859). **No PR**: auto-memory 77k → 19.6k bytes (26 → 10 files).

**Context cost, measured (owner's ask)**: a fresh session's first API call is ~106k tokens; the panel's "Memory files" line is CLAUDE.md + rules + auto-memory together (≈64k before this session, ≈46k after the two trims land); "Skills" 4.1k is the always-loaded description listing, mostly built-in skills; invoked skill BODIES re-inject under Messages on every compaction (six this session, 155k bytes on disk) — that is the "stays active" cost. The client update landed mid-session: window is now 1M, so compaction pressure is gone and the trims pay on per-call cost only.

**Honest ledger.** The trim's first pass over-cut seven directives the reviewer correctly named, introduced one hedging overclaim ("both emit" for "were measured emitting"), and its commit-message byte table went stale through three autosquashed rounds — exactly the count-rot my own memory warns about; fixed by amend. Net 14.1% against a 30% target (sole-documentation command blocks were a stop condition). The Batch 1 orchestrator self-corrected two false claims in its own comments and found TASK-753 worse than filed. The #2291 reviewer caught a wrapper bypass in the new tracker guard that the same PR had closed one hook over — the probe suite lacked a quoted-wrapper fixture.

## 🌙 2026-08-31 (day) — beta.212: full cycle in one session (Fable-driven, nested dispatch)

**v3.0.0-beta.212 CUT + MERGED + PUBLISHED same-day.** Nine work PRs merged (#2270–#2277 + deps), release PR #2279 clean on the holistic review, finalize aligned develop, beta.211 demoted. Every implementation unit went through nested dispatch (Opus orchestrator + Sonnet worker, isolated worktrees, byte-identical patch transfer).

**Shipped**: **TASK-837** (#2270, 4 rounds — embed thumbnails carry link-preview provenance at every render surface; residue TASK-840/841/842) · **TASK-816 tranche 1** (#2271–#2274, ~120 tests: conversation-history 85.64→97.39 with the decay confirmed real, clients →98.42 ceiling, cache-invalidation →97.53, config-resolver →96.54; every survivor dispositioned) · **floors banked** (#2275, owner picked raise-all-five; sanctioned path, all-fresh reports) · **TASK-839** (#2277, 3 rounds — Parent Value renders the parent tier; the task's pre-local-snapshot sketch was falsified for the channel dashboard, winner-relative shipped instead; **smoke-verified by owner screenshot**) · **dependabot batch** (owner ask: #2269 dev deps + @types/node compat fix; #2276 prod deps ×12 — dependabot closed #2268 and recreated it; #2278 claude-code-action via main-cut + finalize, #2267 closed superseded). **TASK-789's retry-classification rider DECIDED** (4-0 council: two specimen-anchored hoists in detectSpecialCases; implementation is size:S, fully specified on the task).

**Honest ledger.** The #2274 reviewer caught two tests my diff read AND the orchestrator both passed — byte-identical duplicates of pre-existing tests (`userRow()`'s defaults collapse the payloads); deleted in round 1. The transfer byte-identity check caught my `git add -A` sweeping an untracked tracker file into a patch. Commitlint tripped me twice (header 107 chars; subject-case on a TASK-prefixed subject) — both documented most-tripped rules. A piped mutation run got SIGPIPE'd by `head` (the lossy-pipe class, self-caught via the report file's mtime). Orchestrator self-catches worth keeping: #2273's spec asserted a kill already pinned at base; #2274's worker ran gates from the main checkout (voided, re-run); #2276's P5 pattern hypothesis was falsified and announced.

## 🌙 2026-08-31 (night) — beta.211 cut + worktree reclaim + TASK-837 filed (Fable-driven)

**v3.0.0-beta.211 CUT + MERGED + PUBLISHED (PR #2265).** Both holistic release reviews clean; the merge gate caught my stale "140 range files" (158 after bump + a filing) — fixed pre-merge. Finalize aligned develop; beta.210 demoted. **Three runtime-unverified watchers went live in prod** (restart recovery #2253, guest 429 floor, GLM rescue) plus the owner's #2259 masked-link smoke item.

**Worktree reclaim: 10 stale agent worktrees removed (7.9 GB), 15 `worktree-agent-*` branches deleted.** The session-close test FAILED — locks are plain files naming a dead pid; the harness never cleans up (feedback drafted; cleanup procedure saved to auto-memory).

**Honest ledger.** My "closing the session releases the locks" prediction was wrong. The "zero unpushed commits" sweep had `2>/dev/null` on it and was wrong for 4 of 10 worktrees. I pushed a docs commit to develop mid-release-CI (~5 min cost — hold docs pushes while a release PR is in CI). Count-rot: gate-caught again. Tail4 mining ran on the Opus window; **#2266 MERGED** (turn-end shape + notify rule + per-commit dispatch re-arm); **⚖️ ROADMAP RATIFIED** (three phases in `cold/queue.md`; drain is the official epic; doc-88 + TASK-838 filed).

## 📋 Open items (near-term)

- **beta.213 slate (`now.md` § 🚢), Fable-driven since the 2026-09-01 reset**: remaining in order — #2291 Batch 1 review rounds → Batch 2 (dispatched) → **floor raise LAST** (all five tracked packages measured locally, sequential, then `mutation:update-baseline`) → cut prep (`release:range`; release PR needs explicit owner approval; the two deferred mining-operationalization process PRs are an owner budget call). Then **session mining** (`/tzurot-session-mining`). Kept out: doc-87, TASK-844/845, doc-86, doc-8, TASK-730. Owner calls parked on #2290's body: the 05-tooling command-reference lever and a skills economy pass.
- **TASK-816 remaining clauses** (a) ratchet classification recorded at definition (b) named recurring trigger (d) audit reports distance-above-floor — the floors themselves are raised and banked; these are the mechanism clauses. doc-63 owns the theme.
- **Prod watchers live (event-driven, quiet)**: restart recovery (#2253) · guest 429 floor · GLM `model_not_found (rescued)` embeds · **NEW: #2270's first real link-share** (provenance render — `/inspect` observability, no smoke needed) · the #2277 deploy-window transient (accepted, self-heals).
- **TASK-791 (high)** — instrumentation live; fix half wakes on the next prod `empty_response` window.
- **🔍 SMOKE ITEM, owner-only (#2259 round 2)**: failed `/inspect` diagnostic with a masked link in the provider error → Error field renders inert literal text. The one clause no local test can close.
- **beta.209 open clauses:** TASK-598 (worktree-push, close after a quiet stretch) · TASK-764 (experiential /deny) · TASK-612 (runtime invalidation) · TASK-782 watch · TASK-795 · TASK-775.
- **Usage posture:** owner call 2026-08-31 — heavy Fable today against yesterday's surplus; beta.213 goes to Opus.
- `ConversationHistoryEntry` (pipeline/types.ts) Pick/Omit fold still carried for whichever slice next touches the wire shape.

## 🔧 DRAIN CAMPAIGN — standing; batching is the method

Backlog ~427 open (2026-08-29 digest). **Themed batches, 3–5 same-area size:S per PR (owner call 2026-08-28).** Pre-grounded remainder: 199 solo; held for owner: 527 · 540 · 559 · 531; TASK-599 = the batched owner-decision pass. Query, don't browse: `pnpm tracker task list -s "To Do" -l state:ready -l size:S --plain` (the `-s "To Do"` is load-bearing).

**Carry-forwards (one shape — a check that can't distinguish measured-fine from didn't-measure):** publish the command, never the hand-restated number; negative-control a FIX by running it; a probe that swallows stderr certifies broken code green.

**Structural sweep (this session): nothing new needs structure.** Recurrences all landed on existing rails: commitlint trips (documented most-tripped rules), the branch-gate compound-command timing (each gate's own message carries the split fix), the head-SIGPIPE (lossy-pipe rule, self-caught).

## 🧵 Standing threads (durable)

- **Voice-consistency harness BUILT (#1910/#1911); remaining: the owner's ~15-min sitting** — blind-review `reports/voice-consistency/judgment-sheet.md` → `pnpm eval:voice-verdict`. **Owner's leisure — do not re-surface.** The #1317 cluster + TASK-165 stay gated behind it.
- **Orchestration record**: TASK-513 + TASK-487 (Sonnet-tier ledger) + the Fable nested-dispatch standard. Today's data point: ~9 units through nested dispatch, one worker-tier semantic defect total (the #2274 duplicate tests — spec/orchestrator-attributable, reviewer-caught). Orchestrator failure shape: a check that inherits the assumption it tests → canary, Core Principle 9.
- Owner-idea council queue: doc-64 (meta-harness) · doc-65 (private brain) · doc-66 (coalescing) · doc-67 (tag-scoped sharing) · doc-70/71/72.
- Waffles' venue-leak report: awaiting their Share Memories answer (doc-8 carries the design input either way).
- TASK-514 (mis-channel WARN watch) · TASK-425/426/410 (bullmq/ioredis v6 pending) · 55 doubled-transcript rows age out ~Sep 2 · doc-59 (BYOK video).
- **Owner decisions locked** (still governing): no asset table for attachments · descriptions live 30d keyed to `DAYS_TO_KEEP_HISTORY` · direct replies always re-vision · extended context re-visions only within retention · undescribed old images render a presence note · extended-context quota exemption AFTER persistence · `maxImages` is a spend cap · moderator cascade (TASK-529) + shared-persona-name collision (TASK-528) fix shapes recorded.
- **Retention calendar**: 200 users; 7 in grace (~09-08 expiries are the next event). Phase 4 autonomy parked BY DESIGN.
- **TASK-671 — memory recirculates stale facts**: step 0 is one string (`MEMORY_ARCHIVE_INSTRUCTION` never mentions time); a concrete argument on doc-8's FOR side.
