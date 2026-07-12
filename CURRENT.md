# Current

> **Version**: v3.0.0-beta.159 (released 2026-07-11, late) — guest picker fix (GLM-4.5-Air selectable for free users), /inspect design-system embeds + facts token-budget bar + model-substitution flag, fence-aware message splitting (long AI code replies render valid markdown), z.ai budget retry-idempotency + admission wiring test. **z.ai free tier LIVE in both envs.** _Prior: beta.158 (2026-07-11, inline inspect views + piggyback)._

---

## Unreleased on Develop

- (empty — beta.159 shipped everything; develop == main)
- **Memory Phase 1a remains PARKED** on `feat/memory-hybrid-retrieval` (resume gate: the goldens session — design DECIDED: committed anonymized set from the owner's own memories, entity-swap + owner review gate).

## Next Session Goal

**beta.159 SHIPPED (owner smoke pending: long-code character reply, /inspect embeds pass, guest picker).** Queued owner-direction: (1) **admin-settings runtime-config BOULDER** — full cadence with trio council; scope decisions recorded in `cold/ideas.md` (two-axis UX, case-by-case flag fates, FULL ~15-var migration set in one slice); (2) **goldens prep** (mining/anonymization script + harness plumbing, then the ~90-min owner labeling session) → unparks memory Phase 1a. Watches: dev backfill (~40%), first guest z.ai traffic (`/admin usage`), Saturday weekly-audit run.

**Open follow-ups from Phase 1** (all in `cold/follow-ups.md` with promote-when triggers): system-voice straggler wording (STT / MessageHandler top-catch / truncation notices), partial-failure errored-slot delivery, admin/kick `serverId` escaping, `deletePersona`/`getCachedPersonalities` wrapper widening, `maxRetries:0` metrics watch.

**Next design/build candidates** (nine accepted artifacts on the books — `docs/proposals/backlog/`): memory Phase 1a (hybrid retrieval, eval-harness-gated), agentic contract-suite prerequisite, profiles Phase 0 (tier-aware quota fallback — closes the live BYOK-dumped-to-error gap), config-cascade Phase 0, or the mechanical queue below. UX Phase 2 later absorbs privacy-epic Part 2 (view/browse unification) + browse isAdmin follow-ups.

**Mechanical work queue (Opus-suitable — build-sized, decisions already written down):** _(swept 2026-07-11: Stryker five-package expansion, CPD campaigns, and DB-perf Phase 1 verified SHIPPED against the code/CI; job-payload contract suite verified shipped (BullMQJobChain.contract.test.ts, 11 tests, real-producer fixture) — the board had rotted)_

1. **shapes-inc fetcher hardening** — 6 small well-specified items.
2. **LLM legacy-column retirement (Phase A DROP + Phase B)** — both destructive-migration-bearing (`release:premigrate --allow-destructive`); a focused moment, not a filler slot.
3. **Follow-ups table sweep** — oldest rows (aging escalates; `pnpm ops backlog` surfaces them).

## Last Session — beta.156 + extraction z.ai track slice 1 (2026-07-10)

Cut beta.156 (memory correction surface + cost knobs + credit-exhaustion fix). Ran the 8-model extraction sweep → **GLM-5.2 selected** (0% violation both runs vs Haiku's 10.3%; dev flipped, burn-in live). Built + merged **PR #1572** (z.ai system key, delay-not-downgrade) through six review rounds — the reviewer caught three real defects the tests missed (partial-batch re-billing, busy retries burning the daily budget, a stale PGLite fixture silently no-oping usage-log coverage), each fixed with a seam test. z.ai quota research distilled into `free-tier-zai-piggyback.md` (quota endpoint + 429 business-code classifier). Process lesson: sweep interface changes by SHAPE, not type name — an untyped `vi.fn()` fixture is invisible to a type-name grep.

_Older session logs live in git history (this file previously carried the 2026-07-03 handoff-refit and beta.146 entries + the full boulder-agenda wall — all shipped/accepted; the artifacts in `docs/proposals/backlog/` are the durable record)._
