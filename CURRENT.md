# Current

> **Version**: v3.0.0-beta.161 (released 2026-07-12 late night) — conditional query-fold gate (memory search stops diluting content-rich turns with recent-chat context; evidence-gated ship off the 1c re-baseline), admin-settings plumbing PR 1 (`system_settings` + `/admin settings set`; shadow until PR 3), main-pool idle-in-tx reaper, db-sync Show-details button, and the full memory-1c eval instrument set (miners, runner, guard, scoring). _Prior: beta.160 (2026-07-12, config/identity sweep)._

---

## Unreleased on Develop

_(empty — reset at beta.161)_

## Next Session Goal

**Next:** (1) **memory 1b (composite scoring)** as the epic's next slice (1c closed: fold-policy decided + shipped #1614; rung-2 refuted); (2) **admin-runtime-settings PR 2 — dashboards** (groups/pagination mechanism, Defaults + System page groups, ride-alongs incl. the #1605 polish follow-ups; then PR 3 consumer swaps + env deletion, PR 4 runtime text fallback descent — artifact amended 2026-07-12 with O8 free-floors-configurable + O9/D12). **beta.161 smoke (observability-first)**: fold gate self-reports per message — `Including recent history in memory search` in prod ai-worker logs should appear on "poke"-class turns and be absent on content-rich ones; check on first organic traffic. beta.160 holdovers (GLM 5.2 /inspect 500K, role="character" sanity, beta.159 items) still open. Watches: dev backfill (~66%), first guest z.ai traffic (`/admin usage`), Saturday weekly-audit run, prod lock-storm recurrence (probe DURING the window — see board entry). Fable access through July 19.

**Open follow-ups from Phase 1** (all in `cold/follow-ups.md` with promote-when triggers): system-voice straggler wording (STT / MessageHandler top-catch / truncation notices), partial-failure errored-slot delivery, admin/kick `serverId` escaping, `deletePersona`/`getCachedPersonalities` wrapper widening, `maxRetries:0` metrics watch.

**Next design/build candidates** (nine accepted artifacts on the books — `docs/proposals/backlog/`): memory Phase 1b (composite scoring — unblocked by Phase 2's types; 1a decided-parked, 1c concluded), agentic contract-suite prerequisite, profiles Phase 0 (tier-aware quota fallback — closes the live BYOK-dumped-to-error gap), config-cascade Phase 0, or the mechanical queue below. UX Phase 2 later absorbs privacy-epic Part 2 (view/browse unification) + browse isAdmin follow-ups.

**Mechanical work queue (Opus-suitable — build-sized, decisions already written down):** _(swept 2026-07-11: Stryker five-package expansion, CPD campaigns, and DB-perf Phase 1 verified SHIPPED against the code/CI; job-payload contract suite verified shipped (BullMQJobChain.contract.test.ts, 11 tests, real-producer fixture) — the board had rotted)_

1. **shapes-inc fetcher hardening** — 6 small well-specified items.
2. **LLM legacy-column retirement (Phase A DROP + Phase B)** — both destructive-migration-bearing (`release:premigrate --allow-destructive`); a focused moment, not a filler slot.
3. **Follow-ups table sweep** — oldest rows (aging escalates; `pnpm ops backlog` surfaces them).

## Last Session — the honest re-baseline + conditional fold night (2026-07-12 late)

The 1c arc closed end-to-end and shipped as beta.161. Machinery: fold param (#1610), conversation-goldens miner (#1611), fold-aware runner + non-circularity guard (#1612), scoring instrument + hard-erroring qrels reconciliation (#1613 — the reconcile guard caught a real cross-golden mis-attribution in MY hand-judging, exactly its job). The measurement: 40 real Lila turns hand-judged in-context → **production's uniform fold was neutral-to-negative** (bare 0.436 vs fold3 0.390 recall@10; both-miss 8% vs 19%); per-style split showed fold helps reactive turns, hurts content-rich ones; the old "30% both-miss" was a toy-corpus strawman; rung-2 (LLM query rewrite) refuted. Owner picked conditional-fold → pre-registered gate simulated offline against the already-judged pool (**the pooled design is a free policy simulator** — any per-turn arm selection is scoreable retroactively): cond 0.548 recall@10, 1/37 both-miss, 4 fixes / 0 breaks vs bare → wired + shipped same session (#1614, review: "no blocking"). Release beta.161 cut with premigrate-first flow. Honest ledger: one judging mis-key (caught structurally, fixed in one pass), one test-arithmetic slip caught by my own recount, and the sim's circularity caveat (validated on the hypothesis-generating corpus; mitigated by pre-registration + threshold sensitivity — fresh-mine holdout available any week).

## Prior Session — the settings-plumbing + goldens day (2026-07-12 daytime)

Four merges: admin-runtime PR 1 (#1605, incl. an artifact amendment cycle: owner made all four floors configurable + added D12 runtime text-fallback descent), the pool guard (#1606, born from a live prod lock storm diagnosed mid-session — owner-approved pg_stat_activity probe found the holder gone and server timeouts all 0), the db-sync details button (#1607, owner UX critique → shipped same day), and the goldens miner (#1608, five review rounds). Owner falsified the committed-goldens premise by asking "have you looked at the content?" — real samples carried third-party accounts + medical detail → storage revised to LOCAL-ONLY. Quick Wins drained 4→1 (extraction verified already live in prod — owner's "search order" beat the stale board again). Honest ledger: reviewer caught real bugs in MY fresh code all day (z-ai prefix vs bare-key catalog lookup — my tests only proved the negative case; stratification skew 9:1 vs intended 3:1 — my test was too weak to notice; $-replacement semantics; senders missing from the leftover scan), plus one self-inflicted fixup-targeting slip that squashed code into a docs commit (caught in push output, repaired via soft-reset re-split). The eval-corpus verdict pattern from the day: a reviewer hypothesis is settled by a runtime test, not debate — the PGLite component test refuted the @updatedAt concurrency concern and pinned it forever.

_Older session logs live in git history (the config/identity bug night, the 2026-07-03 handoff-refit, and earlier entries — all shipped; the artifacts in `docs/proposals/backlog/` are the durable record)._
