# Current

> **Version**: v3.0.0-beta.160 (released 2026-07-12) — the config/identity sweep: user-preset params restored (prod bug since 06-17), sibling personas render role="character", facts subject-binding, vision-config params honored per tier, vision single-flight coalescing (multi-tag = one provider call), structural prerelease sweep. _Prior: beta.159 (2026-07-11, guest picker + /inspect embeds + fence-aware splitting)._

---

## Unreleased on Develop

- (empty — beta.160 shipped everything; develop == main)
- **Memory Phase 1a remains PARKED** on `feat/memory-hybrid-retrieval` (resume gate: the goldens session — design DECIDED: committed anonymized set from the owner's own memories, entity-swap + owner review gate).

## Next Session Goal

**beta.160 SHIPPED (owner smoke pending)** — risk-ordered: (1) /inspect Token Budget on the GLM 5.2 preset → Context window 500,000 (the original 100K report is the prod re-verification of the stamp fix); (2) tag TWO characters with one image → one "Coalesced onto concurrent vision describe" log, single provider call; (3) multi-persona thread sanity (role="character"); (4) beta.159 holdovers: long-code reply, /inspect embeds, guest picker. Then: (1) **admin-runtime-settings BUILD** — design ACCEPTED 2026-07-12 ([`docs/proposals/backlog/admin-runtime-settings.md`](docs/proposals/backlog/admin-runtime-settings.md), trio council + owner sign-off; 3 PR slices: plumbing+slash setter → dashboards → consumer swaps + env deletion last); (2) **goldens prep** → unparks memory Phase 1a. Watches: dev backfill (~55%), first guest z.ai traffic (`/admin usage`), Saturday weekly-audit run.

**Open follow-ups from Phase 1** (all in `cold/follow-ups.md` with promote-when triggers): system-voice straggler wording (STT / MessageHandler top-catch / truncation notices), partial-failure errored-slot delivery, admin/kick `serverId` escaping, `deletePersona`/`getCachedPersonalities` wrapper widening, `maxRetries:0` metrics watch.

**Next design/build candidates** (nine accepted artifacts on the books — `docs/proposals/backlog/`): memory Phase 1a (hybrid retrieval, eval-harness-gated), agentic contract-suite prerequisite, profiles Phase 0 (tier-aware quota fallback — closes the live BYOK-dumped-to-error gap), config-cascade Phase 0, or the mechanical queue below. UX Phase 2 later absorbs privacy-epic Part 2 (view/browse unification) + browse isAdmin follow-ups.

**Mechanical work queue (Opus-suitable — build-sized, decisions already written down):** _(swept 2026-07-11: Stryker five-package expansion, CPD campaigns, and DB-perf Phase 1 verified SHIPPED against the code/CI; job-payload contract suite verified shipped (BullMQJobChain.contract.test.ts, 11 tests, real-producer fixture) — the board had rotted)_

1. **shapes-inc fetcher hardening** — 6 small well-specified items.
2. **LLM legacy-column retirement (Phase A DROP + Phase B)** — both destructive-migration-bearing (`release:premigrate --allow-destructive`); a focused moment, not a filler slot.
3. **Follow-ups table sweep** — oldest rows (aging escalates; `pnpm ops backlog` surfaces them).

## Last Session — the config/identity bug night (2026-07-12 overnight)

Owner's "why does /inspect say 100K on a 1M model" unraveled into a **prod regression** (stamp carried only `model` since the 2026-06-17 resolve-once refactor — every other preset field silently used the seed; confirmed via /inspect debug + owner-approved prod DB probe + git archaeology) → fixed in #1600. The same trace surfaced and fixed: multi-persona identity confusion (#1599 role="character"), facts subject ambiguity (#1601), and the vision-axis decorative-config twin (#1602, owner-adjudicated: explicit params win, 0.3 stays default). Honest ledger: the reviewer caught three real gaps in MY fresh code across the night — a missing fallback guard (#1599 r2), a silently no-opped scripted test edit (#1599 r3, prettier changed quoting under my python needle), and #1602's feature being DEAD CODE against the real resolver (my test double fabricated a params-bearing shape the resolver never produced — the mocked-seam class our own rules name). Each fix landed with a real-seam test; the last one caught a snake_case JSONB detail on its first run. Process lesson repeated three ways: trace the enforcement path of every rule you add, and presence-check every scripted edit against the CURRENT file bytes.

_Older session logs live in git history (this file previously carried the 2026-07-03 handoff-refit and beta.146 entries + the full boulder-agenda wall — all shipped/accepted; the artifacts in `docs/proposals/backlog/` are the durable record)._
