# Current

> **Version**: v3.0.0-beta.157 (released 2026-07-10) — fact extraction on z.ai with delay-not-downgrade, memory_facts db-sync, historical backfill command, db-sync deletion tombstones (hard deletes propagate). **Prod extraction is LIVE** (owner flipped all four flags + key on prod ai-worker 2026-07-11; boot clean, zero error logs, z.ai-direct serving). _Prior: beta.156 (2026-07-10, memory correction surface + cost knobs)._

---

## Unreleased on Develop

- **PR #1581** — db-sync output rework (summary embed + attached `db-sync-report.md`, row-level deletion detail, dead `changes` field removed) + tombstone-trigger drift guard (`validateTombstoneTriggers`, sync-time AND build-time via PGLite) + dead `softDeleteMessage` deleted. Consolidation verdict recorded in the PR body: the two tombstone systems stay distinct (soft-delete capture point + bulk write amplification).
- **PR #1582** — `commands:audit` vocabulary registrations (`facts`, `avatar-clear`); weekly-audit WARN cleared.
- **PR #1583** — weekly-audit security surface: `GH_TOKEN` env + first-informative-stderr-line fix. Watch next Saturday's run (403 → fine-grained PAT; follow-up row filed).
- **PR #1584** — z.ai GLM-4.5-Air free-tier piggyback, SHIPS DARK behind `ZAI_FREE_TIER_ENABLED`. Admission chain (kill switch / window-exhausted cooldown / 75% live-meter headroom / zaifreeq:* fair share), silent degrade to `openrouter/free`, paid-leak guard on all guest paths, /admin usage plan meters, glm-4.5-air selectable as free default. **Owner dev-enable steps**: `/preset free-default` → pick the GLM-4.5-Air preset; set `ZAI_FREE_TIER_ENABLED=true` on dev ai-worker; guest smoke + watch `/admin usage`. Structure-test exclusion narrowed: `jobs/handlers/pipeline/**` now enforces colocated tests (the gap the round-2 review exposed).
- **PR #1585** — LONG_SYNC 5-min timeout tier for db-sync/cleanup (a fact-carrying sync false-failed at 30s while succeeding server-side, delivering 3,722 facts to prod); async-job refactor filed with triggers.
- **PR #1586** — PreToolUse hook blocking filtered `git commit`/`git push` output (4x recurring failure class), 19-case CI test matrix in tooling.
- **PR #1587** — tombstone component-test determinism (same-ms LWW tie backdated; had flaked two unrelated PRs in one hour).
- Docs: four orphaned reference docs linked from the docs index (audit report-only item).
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
