# Current

> **Version**: v3.0.0-beta.156 (released 2026-07-10) — memory correction surface (`/memory facts` quality + correction slices), extraction cost knobs, fair-share quota, credit-exhaustion fallback fix. _Prior: beta.155 (2026-07-08, UX Phase 1 honest-outcome layer)._

---

## Unreleased on Develop

- **PRs #1572–#1578** (7 substantive) — the full z.ai/memory train: extraction on the system plan with delay-not-downgrade (#1572), memory_facts db-sync (#1573), the backfill command (#1574), review-cycle rules (#1575), db-sync soak-window fix (#1576), facts sharing parity (#1577), and the delay-mechanism fix + poison-batch cap (#1578 — the backfill's first busy window exposed worker.rateLimit as a deprecated no-op; moveToDelayed+DelayedError now, 180s timeout, busyCycles cap). All flag-gated dark on prod. **Release-cut proposal pending owner approval.**
- **Memory Phase 1a remains PARKED** on `feat/memory-hybrid-retrieval` (evidence gate: real-scale goldens).

## Next Session Goal

**beta.157 chain = Memory Phase 2 goes live in prod.** ~~(1) dev env vars + confirmation eval~~ ✅ · ~~(2) memory_facts db-sync~~ ✅ (#1573) · ~~(3) backfill command~~ ✅ (#1574) — **FULL DEV RUN IN FLIGHT since 2026-07-10 ~16:45 ET**: 6,196 windows enqueued (canary verified: real facts, `zai-coding` attribution, embeddings; skip-covered proven live). Self-paced 1-3 days (priority-below-live, delay-not-downgrade through z.ai peaks). **Progress check**: `SELECT COUNT(*) FROM memory_facts` + covered-episode count vs 35,303, or `pnpm ops memory:backfill-facts --env dev --dry-run` (remaining eligible shrinks to 0); re-running the command any time is safe (skip-covered + jobId dedup). · (4) prod-enable after the run + owner smoke (`EXTRACTION_ENABLED`, `FACTS_IN_PROMPT_ENABLED`, `EXTRACTION_MODEL=z-ai/glm-5.2` + provider vars; prod release needs `release:premigrate` for the deferral migration; facts themselves reach prod via db-sync — no prod re-run). **Owner dev smoke of `/memory facts` now has real data.** Queued right behind the chain: db-sync deletion tombstones (owner pain, design filed).

**Open follow-ups from Phase 1** (all in `cold/follow-ups.md` with promote-when triggers): system-voice straggler wording (STT / MessageHandler top-catch / truncation notices), partial-failure errored-slot delivery, admin/kick `serverId` escaping, `deletePersona`/`getCachedPersonalities` wrapper widening, `maxRetries:0` metrics watch.

**Next design/build candidates** (nine accepted artifacts on the books — `docs/proposals/backlog/`): memory Phase 1a (hybrid retrieval, eval-harness-gated), agentic contract-suite prerequisite, profiles Phase 0 (tier-aware quota fallback — closes the live BYOK-dumped-to-error gap), config-cascade Phase 0, or the mechanical queue below. UX Phase 2 later absorbs privacy-epic Part 2 (view/browse unification) + browse isAdmin follow-ups.

**Mechanical work queue (Opus-suitable — build-sized, decisions already written down):**

1. **Stryker per-package expansion** — recipe in the deterministic-test-quality theme; order: conversation-history → identity → cache-invalidation → clients (services need the viability measurement first).
2. **Job-payload contract suite** (agentic prerequisite) — every context shape → job-chain → worker consumption; consider fast-check.
3. **CPD campaign 1** (`LlmConfigService` ↔ `TtsConfigService`) — council pass first, then extraction under the 2-callback ceiling.
4. **Database-performance-audit Phase 1** (prevention-rule PR) — cheap, marked NEXT in its theme.
5. **shapes-inc fetcher hardening** — 6 small well-specified items.
6. **LLM legacy-column retirement (Phase A DROP + Phase B)** — both destructive-migration-bearing (`release:premigrate --allow-destructive`); a focused moment, not a filler slot.
7. **Follow-ups table sweep** — oldest rows (aging escalates; `pnpm ops backlog` surfaces them).

## Last Session — beta.156 + extraction z.ai track slice 1 (2026-07-10)

Cut beta.156 (memory correction surface + cost knobs + credit-exhaustion fix). Ran the 8-model extraction sweep → **GLM-5.2 selected** (0% violation both runs vs Haiku's 10.3%; dev flipped, burn-in live). Built + merged **PR #1572** (z.ai system key, delay-not-downgrade) through six review rounds — the reviewer caught three real defects the tests missed (partial-batch re-billing, busy retries burning the daily budget, a stale PGLite fixture silently no-oping usage-log coverage), each fixed with a seam test. z.ai quota research distilled into `free-tier-zai-piggyback.md` (quota endpoint + 429 business-code classifier). Process lesson: sweep interface changes by SHAPE, not type name — an untyped `vi.fn()` fixture is invisible to a type-name grep.

_Older session logs live in git history (this file previously carried the 2026-07-03 handoff-refit and beta.146 entries + the full boulder-agenda wall — all shipped/accepted; the artifacts in `docs/proposals/backlog/` are the durable record)._
