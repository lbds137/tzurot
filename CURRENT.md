# Current

> **Version**: v3.0.0-beta.156 (released 2026-07-10) — memory correction surface (`/memory facts` quality + correction slices), extraction cost knobs, fair-share quota, credit-exhaustion fallback fix. _Prior: beta.155 (2026-07-08, UX Phase 1 honest-outcome layer)._

---

## Unreleased on Develop

- **PR #1572** — extraction on the z.ai system key with delay-not-downgrade. Dev is LIVE on the plan (vars set 2026-07-10; boot clean; z.ai confirmation eval 50/50 parse, 0/52 effective fabrication).
- **PR #1573** — `memory_facts` joins db-sync (DEFERRABLE self-FK migration — applied to dev — + `VECTOR_SYNC_TABLES` registry; corrections/forgets/locks propagate as columns, hard deletes don't pending the `sync_tombstones` design in `cold/ideas.md`).
- **Memory Phase 1a remains PARKED** on `feat/memory-hybrid-retrieval` (evidence gate: real-scale goldens).

## Next Session Goal

**beta.157 chain = Memory Phase 2 goes live in prod.** ~~(1) dev env vars + confirmation eval~~ ✅ · ~~(2) memory_facts db-sync~~ ✅ (#1573) · **(3) NEXT: fact backfill ops command** (`ops memory:backfill-facts` — content-hash idempotent, dev first, reuses the whole extraction pipeline; ride-along: `ops run --service <name>` full-var injection, design agreed with owner — see the backfill entry in `cold/ideas.md`) · (4) prod-enable (`EXTRACTION_ENABLED`, `FACTS_IN_PROMPT_ENABLED`, `EXTRACTION_MODEL=z-ai/glm-5.2` + provider vars; prod release needs `release:premigrate` for the deferral migration). Owner dev smoke of `/memory facts` still outstanding. Queued right behind the chain: db-sync deletion tombstones (owner pain, design filed).

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
