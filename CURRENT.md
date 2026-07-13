# Current

> **Version**: v3.0.0-beta.162 (released 2026-07-13 morning) — the admin-runtime-settings epic complete: paged settings dashboards (7 admin pages incl. owner-only System pages), all 17 system settings runtime-live through the SWR cache (15 env vars retired), runtime text fallback descent to the configurable floors, and the release-review-caught free-model firewall at every floor read. _Prior: beta.161 (2026-07-12, conditional query-fold + admin-settings plumbing)._

---

## Unreleased on Develop

_(empty — reset at beta.162)_

## Next Session Goal

**Next:** **memory 1b (composite scoring)** — grounding staged in the plan file; needs owner + plan-mode (schema-bearing: episode type/salience deferred from Phase 2 into 1b; weights measured against the 1c judged pool before wiring — the conditional-fold pattern). **beta.162 smoke (observability-first)**: prod boot logs must show `Fact-extraction assembly constructed ... extractionEnabled=true` (bag repaired pre-release, verified); one normal reply proves the generation path; the descent self-reports via footer + audit on its first organic model failure (a real case study exists: Duo's 5:14 AM triple-timeout would have been rescued). Operational tail: Railway env cleanup (15 retired vars — dev first, dashboard op), owner decisions in `cold/follow-ups.md` (floor-vs-default constants, artifact retirement), retention transaction-expiry recurrence check (board § New). Watches: dev backfill (resumed, ~82%), beta.161 fold-gate + beta.160 holdovers still open, prod lock-storm recurrence. Fable access through July 19.

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
