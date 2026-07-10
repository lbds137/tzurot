# Current

> **Version**: v3.0.0-beta.156 (released 2026-07-10) — memory correction surface (`/memory facts` quality + correction slices), extraction cost knobs, fair-share quota, credit-exhaustion fallback fix. _Prior: beta.155 (2026-07-08, UX Phase 1 honest-outcome layer)._

---

## Unreleased on Develop

- **PR #1572** — extraction rides the z.ai system key with delay-not-downgrade (`ZAI_CODING_API_KEY` + `EXTRACTION_PROVIDER`; busy → `Worker.RateLimitError` requeue, budget-neutral refunds, requeue shrinks to unfinished groups, sustained-busy escalation at ~6h). Defaults unchanged until env flips.
- **Memory Phase 1a remains PARKED** on `feat/memory-hybrid-retrieval` (evidence gate: real-scale goldens).

## Next Session Goal

**beta.157 chain = Memory Phase 2 goes live in prod.** In order: (1) **OWNER: set `ZAI_CODING_API_KEY` + `EXTRACTION_PROVIDER=zai-coding` on dev ai-worker** (I never touch secrets) → one free confirmation eval via the z.ai endpoint; (2) `memory_facts` into db-sync SYNC_CONFIG (vector col + self-FK ordering + deliberate cascade answer — focused PR); (3) fact backfill ops command (now unblocked by #1572 pending the env vars; content-hash idempotent, dev first); (4) prod-enable (`EXTRACTION_ENABLED`, `FACTS_IN_PROMPT_ENABLED`, `EXTRACTION_MODEL=z-ai/glm-5.2` + provider vars). Owner dev smoke of `/memory facts` still outstanding.

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
