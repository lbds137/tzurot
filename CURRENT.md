# Current

> **Version**: v3.0.0-beta.158 (released 2026-07-11) — /inspect inline chunked views (no more file downloads for readable text; token budget embed, voice attribution view), db-sync inline report + row-level deletions + tombstone drift guard, z.ai GLM-4.5-Air free-tier piggyback (conditionally-free cascade, #1590 held the release), LONG_SYNC timeout tier, commit-filter guard hook. **z.ai free tier is LIVE in dev AND prod** (owner flipped `ZAI_FREE_TIER_ENABLED` + key on both, 2026-07-11; defaults = 75% headroom / 1000 daily). Prod extraction remains live. _Prior: beta.157 (2026-07-10, fact extraction + tombstones)._

---

## Unreleased on Develop

- **PR #1591** — z.ai admission chain wiring test (real overrides → admission → meter + quota over fake Redis; only the z.ai HTTP boundary mocked). Closed the release-review rule-7 gap; en-route finding: the per-user window cap denies same-request retries under tight config, so the global-counter double-count needs user headroom to occur.
- **PR #1592** — guest pickers honor the conditionally-free piggyback model (owner-reported: not selectable in `/settings preset set-default`). Availability gates → `isFreeTierEligibleModel`; NEW `isFreeModelForUser` audience predicate (owner call: free for guests, paid for key-holders) across 🆓 badge / free-count / 'free' scope / models usability; review-caught `models/view.ts` wallet-failure empty-Set→null contract fix.
- **PR #1593** — fact tokens surfaced in /inspect token budget (owner-reported: facts invisible). Facts get their own bar subtracted out of System (they render inside the system prompt), included/dropped counts in Notes; `recordBudgetDiagnostics` was the seam that dropped `factTokensUsed`. Older logs render the legacy chart. Step-3 retrieval extracted to `factRetrievalHelper.retrieveMemoriesAndFacts` (line cap).
- **Memory Phase 1a remains PARKED** on `feat/memory-hybrid-retrieval` (evidence gate: real-scale goldens).

## Next Session Goal

**beta.157 SHIPPED — remaining chain = prod-enable.** ~~(1) dev env vars + eval~~ ✅ · ~~(2) memory_facts db-sync~~ ✅ · ~~(3) backfill command~~ ✅ · ~~db-sync deletion tombstones~~ ✅ (#1579; drift-guard follow-up filed in `cold/follow-ups.md`) · ~~release cut~~ ✅ (beta.157, 2026-07-10; both migrations pre-applied to prod). **Still open**: ~~(a) owner smoke of db-sync~~ ✅ PASSED (owner, 2026-07-10 post-release); (b) **full dev backfill run IN FLIGHT** since 2026-07-10 ~16:45 ET — 6,196 windows, self-paced 1-3 days, persistent monitor reporting every 30 min; progress: `pnpm ops memory:backfill-facts --env dev --dry-run` (remaining shrinks to 0); ~~(c) prod-enable~~ ✅ **DONE (owner, 2026-07-11)** — all four flags + key live on prod ai-worker; discovered via the env-var audit, verified healthy (no coherence errors, z.ai-direct serving). ~~Owner smoke of `/memory facts` on prod~~ ✅ PASSED (owner, 2026-07-11 — 3,722 facts arrived via the first fact-carrying db-sync). Optional residual check: facts visible in the assembled system prompt via prod `/inspect`.

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
